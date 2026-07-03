import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import WalletConnect from "@/components/features/wallet/WalletConnect";
import { useWalletStore } from "@/stores/walletStore";

vi.mock("@/components/providers/StellarProvider", () => ({
  useStellar: () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    isFreighterInstalled: true,
  }),
}));

beforeEach(() => {
  useWalletStore.getState().reset();
});

describe("Smoke: Wallet Connection", () => {
  it("renders connect button when disconnected", () => {
    render(<WalletConnect />);
    expect(
      screen.getByRole("button", { name: /connect freighter/i }),
    ).toBeInTheDocument();
  });

  it("shows connected state with wallet address", () => {
    useWalletStore.setState({
      isConnected: true,
      publicKey: "GBXTQW2V3MHZLZ5K2JZ29MQJ3DQJ29MQJ3DQJ29MQJ29MQJ29MQJ29MQ",
    });

    render(<WalletConnect />);
    expect(
      screen.getByRole("button", { name: /wallet menu/i }),
    ).toBeInTheDocument();
  });

  it("shows loading state during connection", () => {
    useWalletStore.setState({ isLoading: true });

    render(<WalletConnect />);
    expect(
      screen.getByRole("button", { name: /connecting/i }),
    ).toBeInTheDocument();
  });

  it("displays error toast when error is set", () => {
    useWalletStore.setState({ error: "Connection rejected" });

    render(<WalletConnect />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Connection rejected")).toBeInTheDocument();
  });
});
