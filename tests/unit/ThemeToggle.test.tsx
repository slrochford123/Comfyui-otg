import { fireEvent, render, screen } from "@testing-library/react";
import ThemeToggle from "../../app/components/ThemeToggle";

describe("ThemeToggle", () => {
  it("toggles label", async () => {
    render(<ThemeToggle />);

    // default is purple
    const btn = screen.getByRole("button", { name: /purple|neon/i });
    const first = btn.textContent;

    fireEvent.click(btn);

    // after click should flip
    expect(screen.getByRole("button").textContent).not.toEqual(first);
  });
});
