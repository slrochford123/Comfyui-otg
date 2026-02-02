import React from "react";
import { Chip } from "../ui/Chip";
import type { Ratio, Size } from "../../lib/generator/types";

const ratioOptions: Ratio[] = ["auto", "16:9", "9:16", "1:1", "4:3"];
const sizeOptions: Size[] = [256, 384, 512, 768];

export function VideoProfilePicker(props: {
  ratio: Ratio;
  size: Size;
  onChangeRatio: (v: Ratio) => void;
  onChangeSize: (v: Size) => void;
  disabled?: boolean;
}) {
  const { ratio, size, onChangeRatio, onChangeSize, disabled } = props;

  return (
    <div className="otg-card">
      <div className="otg-cardTitle">Video Profile</div>

      <div className="otg-cardSubtitle">Ratio</div>
      <div className="otg-row otg-wrap">
        {ratioOptions.map((r) => (
          <Chip
            key={r}
            active={ratio === r}
            disabled={disabled}
            onClick={() => onChangeRatio(r)}
          >
            {r}
          </Chip>
        ))}
      </div>

      <div className="otg-cardSubtitle" style={{ marginTop: 10 }}>
        Size
      </div>
      <div className="otg-row otg-wrap">
        {sizeOptions.map((s) => (
          <Chip
            key={s}
            active={size === s}
            disabled={disabled}
            onClick={() => onChangeSize(s)}
          >
            {s}
          </Chip>
        ))}
      </div>
    </div>
  );
}
