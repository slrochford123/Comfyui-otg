import { render, screen } from "@testing-library/react";
import HeaderBar from "../../app/components/HeaderBar";

describe("HeaderBar", () => {
  it("renders title", () => {
    render(<HeaderBar isConnected={true} />);
    expect(screen.getByRole("heading", { name: /comfyui otg/i })).toBeInTheDocument();
  });

  it("shows Connected when isConnected=true", () => {
    render(<HeaderBar isConnected={true} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("shows Disconnected when isConnected=false", () => {
    render(<HeaderBar isConnected={false} />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });
});
