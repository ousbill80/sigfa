/**
 * Tests for SocketProvider — WEB-001
 * @module lib/socket-provider.test
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SocketProvider, useSocket } from "./socket-provider";
import React, { type ReactElement } from "react";

function TestChild(): ReactElement {
  const socket = useSocket();
  return (
    <div>
      <span data-testid="status">{socket.status}</span>
      <span data-testid="connected">{String(socket.connected)}</span>
    </div>
  );
}

describe("SocketProvider", () => {
  it("is INACTIVE by default (no socket connection until RT-001)", () => {
    const { getByTestId } = render(
      <SocketProvider>
        <TestChild />
      </SocketProvider>
    );
    expect(getByTestId("status").textContent).toBe("inactive");
    expect(getByTestId("connected").textContent).toBe("false");
  });

  it("provides context to children", () => {
    const { getByTestId } = render(
      <SocketProvider>
        <TestChild />
      </SocketProvider>
    );
    expect(getByTestId("status")).toBeTruthy();
  });
});
