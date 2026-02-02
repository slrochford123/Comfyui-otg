type Props = {
  disabled?: boolean;
  isLoading?: boolean;
  onClick: () => void;
  hint?: string;
};

export default function GenerateButton({ disabled, isLoading, onClick, hint }: Props) {
  const isDisabled = !!disabled || !!isLoading;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        disabled={isDisabled}
        className={[
          "w-full py-4 sm:py-5 rounded-2xl font-semibold shadow-2xl transition",
          "text-base sm:text-lg",
          isDisabled
            ? "bg-white/10 text-white/50 cursor-not-allowed"
            : "bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400 hover:opacity-95 active:scale-[0.99]",
        ].join(" ")}
      >
        {isLoading ? "Generating…" : "Generate"}
      </button>

      {hint ? <div className="text-xs sm:text-sm opacity-55">{hint}</div> : null}
    </div>
  );
}