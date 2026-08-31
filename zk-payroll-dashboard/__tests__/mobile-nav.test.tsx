import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DashboardLayout from "@/components/layout/DashboardLayout";

describe("mobile dashboard navigation", () => {
  it("opens the accessible navigation sheet with the primary routes", () => {
    render(
      <DashboardLayout>
        <p>Dashboard content</p>
      </DashboardLayout>,
    );

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger).toHaveClass("md:hidden");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    const dialogQueries = within(dialog);
    expect(dialog).toBeInTheDocument();
    expect(dialogQueries.getByRole("link", { name: "Employees" })).toBeInTheDocument();
    expect(
      dialogQueries.getByRole("link", { name: "Execute Payroll" }),
    ).toBeInTheDocument();
    expect(dialogQueries.getByRole("link", { name: "History" })).toBeInTheDocument();
  });

  it("closes on Escape and after selecting a route", () => {
    render(
      <DashboardLayout>
        <p>Dashboard content</p>
      </DashboardLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
