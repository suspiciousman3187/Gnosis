export default function SiteFooter() {
  return (
    <footer className="w-full py-6 flex justify-center">
      <div className="inline-flex items-center gap-1.5 text-[11px] text-gray-300 bg-black/60 backdrop-blur-md border border-white/10 rounded-full px-4 py-1.5 shadow-md">
        <span>Made by</span>
        <span className="text-accent font-semibold">Noirblanc</span>
        <span className="text-gray-500">·</span>
        <span>Background by</span>
        <a
          href="https://www.youtube.com/watch?v=jwLMaRNzg3I"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent font-semibold hover:underline underline-offset-2 transition-colors"
        >
          DDal
        </a>
      </div>
    </footer>
  );
}
