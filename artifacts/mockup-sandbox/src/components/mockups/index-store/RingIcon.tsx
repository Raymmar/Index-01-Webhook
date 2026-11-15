export default function RingIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width="100%"
      height="100%"
      role="img"
      aria-labelledby="ring-icon-title"
      style={{ display: "block" }}
    >
      <title id="ring-icon-title">Index 0.1 — the app’s original ring mark</title>
      {/* Same geometry and colors as the existing app logo. The OS supplies
          the icon mask, so the export remains opaque and square. */}
      <rect width="1024" height="1024" fill="#1f2a30" />
      <circle cx="512" cy="512" r="272" fill="none" stroke="#e9e4da" strokeWidth="96" />
      <circle cx="512" cy="240" r="80" fill="#e8674a" />
    </svg>
  );
}
