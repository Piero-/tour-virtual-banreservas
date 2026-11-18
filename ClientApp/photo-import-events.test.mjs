import assert from "node:assert/strict";
import { test } from "node:test";
import { bindPhotoImportEvents } from "./src/photo-import-events.js";

const photo = { name: "photo.png", type: "image/png" };
const transfer = files => ({ files, items: files.map(file => ({
  kind: "file", type: file.type, getAsFile: () => file,
})) });
function event(type, data) {
  const result = new Event(type, { cancelable: true });
  Object.defineProperty(result, type === "paste" ? "clipboardData" : "dataTransfer", { value: data });
  return result;
}

test("whole-page paste and drop import each batch once and remove listeners on cleanup", () => {
  const target = new EventTarget(), batches = [];
  const cleanup = bindPhotoImportEvents(target, { enabled: () => true, importFiles: files => batches.push(files) });
  for (const type of ["paste", "paste", "drop"]) {
    const received = event(type, transfer([photo, photo]));
    target.dispatchEvent(received);
    assert.equal(received.defaultPrevented, true);
  }
  assert.deepEqual(batches.map(files => files.length), [2, 2, 2]);
  cleanup();
  target.dispatchEvent(event("paste", transfer([photo])));
  assert.equal(batches.length, 3);
});

test("public view, text paste and team drags are left untouched", () => {
  const target = new EventTarget();
  let admin = false, calls = 0;
  bindPhotoImportEvents(target, { enabled: () => admin, importFiles: () => calls++ });
  const publicPaste = event("paste", transfer([photo]));
  target.dispatchEvent(publicPaste);
  assert.equal(publicPaste.defaultPrevented, false);
  admin = true;
  for (const type of ["paste", "drop", "dragover"]) {
    const text = event(type, { items: [{ kind: "string", type: "text/plain" }] });
    target.dispatchEvent(text);
    assert.equal(text.defaultPrevented, false);
  }
  assert.equal(calls, 0);
  const drag = event("dragover", transfer([photo]));
  target.dispatchEvent(drag);
  assert.equal(drag.defaultPrevented, true);
  assert.equal(drag.dataTransfer.dropEffect, "copy");
});
