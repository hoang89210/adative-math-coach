import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LEARNER_NOT_SAVED_TEXT } from "./learner-not-saved";

describe("item 9: /results not-saved warning", () => {
  test("includes Vietnamese 'chưa lưu' and stays bilingual", () => {
    assert.match(LEARNER_NOT_SAVED_TEXT, /chưa lưu/);
    assert.match(LEARNER_NOT_SAVED_TEXT, /not added to your learner progress/i);
  });
});
