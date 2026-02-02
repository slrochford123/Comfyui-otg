export default function Header() {
  const connected = true; // visual shell for now

  return (
    <header className="relative overflow-hidden">
      <img
        src="/bg-slr-studios-otg.svg"
        alt="Background"
        className="w-full h-[170px] object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/35 to-[#070412]/95" />

      <div className="absolute left-0 right-0 bottom-0">
        <div className="otg-shell" style={{ paddingBottom: 12 }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/otg-logo.png"
                alt="SLR"
                className="w-11 h-11 rounded-2xl border border-white/10"
              />
              <div>
                <div className="otg-title">SLR Studios OTG</div>
                <div className="otg-subtitle">Creating new worlds on the go.</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="otg-pill">
                {connected ? "ComfyUI Connected" : "ComfyUI Offline"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
