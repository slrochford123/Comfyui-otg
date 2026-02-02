type Props = {
  prompt: string;
  setPrompt: (v: string) => void;
};

export default function EnhanceButton({ prompt, setPrompt }: Props) {
  async function onEnhance() {
    if (!prompt.trim()) return;

    const enhanced =
      prompt +
      "\n\nCinematic, ultra-detailed, realistic lighting, shallow depth of field, professional composition.";

    setPrompt(enhanced);
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onEnhance();
      }}
      className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 transition text-sm"
    >
      Enhance
    </button>
  );
}