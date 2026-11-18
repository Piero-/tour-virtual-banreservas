export function bindPhotoImportEvents(target, { enabled, importFiles }) {
  const images = transfer => {
    const items = [...(transfer?.items ?? [])].filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile()).filter(Boolean);
    return items.length ? items : [...(transfer?.files ?? [])].filter(file => file.type.startsWith("image/"));
  };
  const receive = event => {
    if (!enabled()) return;
    const files = images(event.type === "paste" ? event.clipboardData : event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    importFiles(files);
  };
  const dragOver = event => {
    if (!enabled()) return;
    if ([...(event.dataTransfer?.items ?? [])].some(item => item.kind === "file" && item.type.startsWith("image/"))) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };
  const options = { capture: true };
  target.addEventListener("paste", receive, options);
  target.addEventListener("drop", receive, options);
  target.addEventListener("dragover", dragOver, options);
  return () => {
    target.removeEventListener("paste", receive, options);
    target.removeEventListener("drop", receive, options);
    target.removeEventListener("dragover", dragOver, options);
  };
}
