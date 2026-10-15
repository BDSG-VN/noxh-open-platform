export default function ArchitectureArt() {
  return (
    <svg viewBox="0 0 500 350" fill="none" aria-hidden="true">
      <path fill="#e8f0e9" d="M0 0h500v350H0z" />
      <circle cx="400" cy="70" r="40" fill="#d6e6d4" />
      <path d="M0 290 500 230v120H0z" fill="#d4e3d7" />
      <path d="m95 286 248-30 106 33-264 40z" fill="#bdd0c4" />
      <path d="M133 111h101v177H133z" fill="#fcfdf9" />
      <path d="m234 111 39 18v150l-39 9z" fill="#c0d4cb" />
      <path d="m133 111 40-14h61l39 32-39-18z" fill="#e2ece3" />
      <path d="M275 67h95v199h-95z" fill="#fdfefa" />
      <path d="m370 67 39 23v164l-39 12z" fill="#afc7bd" />
      <path d="m275 67 38-12h57l39 35-39-23z" fill="#e2ece4" />
      <path d="M62 200h70v96H62z" fill="#f8faf4" />
      <path d="m132 200 23 11v79l-23 6z" fill="#b6cdc1" />
      {[0, 1, 2, 3, 4, 5].map((y) => (
        <g key={y}>
          {[0, 1, 2].map((x) => (
            <g key={x}>
              <path fill="#9dbbb2" d={`M${146 + x * 27} ${133 + y * 23}h13v13h-13z`} />
              <path fill="#8eafa5" d={`M${286 + x * 26} ${88 + y * 24}h12v13h-12z`} />
            </g>
          ))}
        </g>
      ))}
      {[0, 1, 2].map((y) => (
        <g key={y}>
          {[0, 1].map((x) => (
            <path key={x} fill="#a3bdb0" d={`M${75 + x * 27} ${219 + y * 22}h13v12h-13z`} />
          ))}
        </g>
      ))}
      <path d="M174 260h20v28h-20zM312 237h22v29h-22z" fill="#8faea2" />
      <path d="M44 302v-34m391 1v-45" stroke="#8faaa0" strokeWidth="4" />
      <ellipse cx="44" cy="257" rx="18" ry="26" fill="#9ab8a3" />
      <ellipse cx="435" cy="211" rx="23" ry="32" fill="#90b09c" />
      <path d="m157 317 122-13 95 16" stroke="#e4ece4" strokeWidth="7" />
      <circle cx="241" cy="298" r="3" fill="#728e83" />
      <path d="M241 301v11" stroke="#728e83" strokeWidth="3" />
    </svg>
  );
}
