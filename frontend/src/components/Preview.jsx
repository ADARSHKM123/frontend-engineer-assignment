// One preview on the board: the screen name above a 1280×800 iframe (R1.1).
// The iframe shows a page from http://localhost:4001, a different origin from the app,
// so the app cannot read the page directly. That comes later, through postMessage.
export default function Preview({ screen }) {
  return (
    <div className="preview">
      <div className="preview-name">{screen.name}</div>
      <div className="preview-frame">
        <iframe src={screen.url} title={screen.name} width="1280" height="800" />
      </div>
    </div>
  );
}
