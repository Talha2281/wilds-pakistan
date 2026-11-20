interface MarkhorHillsLogoProps {
  className?: string;
}

export function MarkhorHillsLogo({ className = 'h-11 w-11' }: MarkhorHillsLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Wild Pakistan logo showing a Markhor in side profile on mountain hills with the sun rising behind it"
    >
      <defs>
        <linearGradient id="wp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b2d3d" />
          <stop offset="62%" stopColor="#134e4a" />
          <stop offset="100%" stopColor="#0f3328" />
        </linearGradient>
        <radialGradient id="wp-sun-glow" cx="50%" cy="46%" r="36%">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.98" />
          <stop offset="45%" stopColor="#f59e0b" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wp-sun-disc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id="wp-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="50%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="wp-hill-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f6f4a" />
          <stop offset="100%" stopColor="#0a2419" />
        </linearGradient>
      </defs>

      {/* Outer medallion */}
      <circle cx="32" cy="32" r="30" fill="url(#wp-sky)" stroke="url(#wp-ring)" strokeWidth="2.5" />

      {/* Warm radiant sun directly behind the Markhor */}
      <circle cx="33" cy="29" r="20" fill="url(#wp-sun-glow)" />
      <circle cx="33" cy="29" r="11.5" fill="url(#wp-sun-disc)" />

      {/* Distant Karakoram snow peaks flanking the sun */}
      <path d="M5 44 L17 24 L26 36 L34 27 L45 19 L59 44 Z" fill="#173a4a" opacity="0.72" />
      <path d="M41 24 L45 19 L49 25 L45 24 Z" fill="#e0f2fe" opacity="0.85" />
      <path d="M14 29 L17 24 L20 29 L17 28 Z" fill="#e0f2fe" opacity="0.78" />

      {/* Mountain hill ridge crest under Markhor */}
      <path
        d="M4 47 Q19 37 32 39 Q46 36 60 47 A30 30 0 0 1 4 47 Z"
        fill="url(#wp-hill-front)"
      />
      <path d="M15 41 Q31 35 48 41 L43 44 L19 44 Z" fill="#2f8d5f" />

      {/* Markhor in proud side-pose silhouette standing on the hill crest, backlit by sun */}
      <g>
        {/* Back/far sweeping spiral horn */}
        <path
          d="M36.5 18.2 C33 11.5, 25 8.5, 19.5 11.2 C16.8 12.6, 17 15.5, 19.8 15.2"
          fill="none"
          stroke="#d6b48a"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        {/* Near sweeping corkscrew Markhor horn */}
        <path
          d="M38.2 18.5 C36.5 10.5, 29.5 6.8, 22.8 9.2 C19.5 10.4, 18.8 13.6, 21.5 14.2"
          fill="none"
          stroke="#f5e3c6"
          strokeWidth="2.3"
          strokeLinecap="round"
        />

        {/* Side-profile body, raised chest, tail, & four legs planted on the crest */}
        <path
          d="M20.5 29.5
             L18.2 27.6
             L20.5 27.0
             Q25 24.8 31.8 25.0
             L35.2 19.4
             L38.2 18.0
             L42.8 19.4
             L43.2 21.2
             L39.6 22.0
             L38.8 24.4
             L39.8 28.4
             L37.4 27.0
             L36.2 31.2
             L38.4 39.2
             L36.5 39.5
             L34.3 32.8
             L32.8 39.5
             L31.0 39.5
             L32.0 32.0
             Q28.2 32.6 25.0 31.6
             L25.6 39.5
             L23.7 39.5
             L22.6 32.8
             L20.8 39.4
             L19.0 39.2
             L20.8 30.8 Z"
          fill="#23160f"
        />
        {/* Warm sun-rim highlight along back & chest */}
        <path
          d="M21.2 26.8 Q26 24.8 32.0 25.1 L35.5 19.5 L38.0 18.4"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="0.9"
          strokeLinecap="round"
          opacity="0.85"
        />
        {/* Flowing throat beard & shaggy mane */}
        <path
          d="M38.8 21.8 L39.8 28.2 L36.8 26.0 Z"
          fill="#3b2618"
        />
        {/* Side profile ear & eye */}
        <path d="M36.0 18.7 L34.2 16.9 L36.9 17.8 Z" fill="#23160f" />
        <circle cx="39.8" cy="19.6" r="0.55" fill="#fde68a" />
      </g>
    </svg>
  );
}
