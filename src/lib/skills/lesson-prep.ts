import { callLlmJson, hasLlmKey } from "@/lib/llm";
import { logError } from "@/lib/log-safe";

import type { TeacherLesson, TeacherPrepState } from "@/lib/types/skills";

type LlmPrepStart = {
  coachPrompt?: string;
  almostRightTrap?: string;
};

type LlmPrepTurn = {
  coachReply?: string;
  readyToFinalize?: boolean;
};

type LlmPrepFinal = {
  prepNoteMarkdown?: string;
};

export function startPrepState(lesson: TeacherLesson): TeacherPrepState {
  const opener = hasLlmKey()
    ? `Key task for students:\n\n${lesson.exploreKeyTask}\n\nTry it yourself first. In one sentence: where could an almost-right answer go wrong?`
    : `Key task:\n${lesson.exploreKeyTask}\n\nTry the task. Reply with one sentence about a likely almost-right mistake.`;

  return {
    componentId: lesson.componentId,
    lessonTitle: lesson.title,
    keyTask: lesson.exploreKeyTask,
    turns: [{ role: "coach", text: opener }],
    status: "active",
  };
}

export async function enrichPrepOpener(
  lesson: TeacherLesson,
  state: TeacherPrepState,
): Promise<TeacherPrepState> {
  if (!hasLlmKey()) return state;
  try {
    const llm = await callLlmJson<LlmPrepStart>({
      system: `You are a lesson-prep partner (Learning Commons k12-lesson-prep style).
Give the teacher the key student task and ONE short question.
Do not generate student worksheets. Keep under 80 words.`,
      user: JSON.stringify({
        title: lesson.title,
        keyTask: lesson.exploreKeyTask,
        goal: lesson.learningGoal,
      }),
    });
    const text = String(llm.coachPrompt ?? state.turns[0]?.text ?? "");
    return {
      ...state,
      turns: [{ role: "coach", text }],
    };
  } catch {
    return state;
  }
}

export async function continuePrep(params: {
  lesson: TeacherLesson;
  state: TeacherPrepState;
  teacherMessage: string;
}): Promise<TeacherPrepState> {
  const next: TeacherPrepState = {
    ...params.state,
    turns: [
      ...params.state.turns,
      { role: "teacher", text: params.teacherMessage },
    ],
  };

  if (!hasLlmKey()) {
    next.turns.push({
      role: "coach",
      text: "Noted. Name one move you will use if that almost-right answer appears. Or say “finalize” for a prep note.",
    });
    return next;
  }

  try {
    const llm = await callLlmJson<LlmPrepTurn>({
      system: `Continue a short lesson-prep dialogue.
Rules from k12-lesson-prep: lead with one thing that matters; few lines; ask at most one question; focus on task design not student labels; correct content errors plainly.
If enough for a prep note, set readyToFinalize true and invite finalize.
Return JSON: {"coachReply":"...","readyToFinalize":false}`,
      user: JSON.stringify({
        lesson: {
          title: params.lesson.title,
          keyTask: params.lesson.exploreKeyTask,
          launch: params.lesson.launch,
          discuss: params.lesson.discuss,
        },
        turns: next.turns,
      }),
    });
    next.turns.push({
      role: "coach",
      text: String(
        llm.coachReply ??
          "What is the one teaching move you will use at the almost-right moment?",
      ),
    });
  } catch (err) {
    logError("Prep turn failed", err);
    next.turns.push({
      role: "coach",
      text: "Thanks. Want a prep note now? Reply “finalize”.",
    });
  }

  return next;
}

export async function finalizePrep(params: {
  lesson: TeacherLesson;
  state: TeacherPrepState;
}): Promise<TeacherPrepState> {
  const fallback = [
    `# Prep note — ${params.lesson.title}`,
    ``,
    `## Launch`,
    params.lesson.launch,
    ``,
    `## Key task`,
    params.lesson.exploreKeyTask,
    ``,
    `## Watch-for`,
    `- Almost-right answers that miss the key idea`,
    `- Representation that hides the structure`,
    ``,
    `## Discuss move`,
    params.lesson.discuss,
    ``,
    `## Exit`,
    params.lesson.exit,
    ``,
  ].join("\n");

  let md = fallback;
  if (hasLlmKey()) {
    try {
      const llm = await callLlmJson<LlmPrepFinal>({
        system: `Write a teacher-only prep note 200-300 words in Markdown.
Walk the lesson parts in teaching order. Bold headings for Launch, Key task, Discuss, Exit.
Use the dialogue findings. No student-facing worksheet.`,
        user: JSON.stringify({
          lesson: params.lesson,
          turns: params.state.turns,
        }),
      });
      if (llm.prepNoteMarkdown) md = String(llm.prepNoteMarkdown);
    } catch (err) {
      logError("Prep finalize failed", err);
    }
  }

  return {
    ...params.state,
    prepNoteMarkdown: md,
    status: "finalized",
    turns: [
      ...params.state.turns,
      {
        role: "coach",
        text: "Prep note is ready. Skim it and tell me if one section should change.",
      },
    ],
  };
}
