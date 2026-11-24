import type { MasteryRecord } from "./mastery";

export function resolveSkillLabel(
  session: MasteryRecord,
  componentId: string,
): string {
  const fromResult = session.result.byComponent.find(
    (c) => c.componentId === componentId,
  );
  if (fromResult?.description) return fromResult.description;

  const fromPriority = session.roadmap?.priorities?.find(
    (s) => s.componentId === componentId,
  );
  if (fromPriority?.skill) return fromPriority.skill;

  const fromStep = session.roadmap?.steps?.find(
    (s) => s.componentId === componentId,
  );
  if (fromStep?.title) return fromStep.title;
  if (fromStep?.description) return fromStep.description;

  return componentId;
}

export function resolvePriorityContext(
  session: MasteryRecord,
  componentId: string,
) {
  return session.roadmap?.priorities?.find((s) => s.componentId === componentId);
}
