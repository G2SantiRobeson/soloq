import { describe, expect, it } from "vitest";
import { AdminRequestError, describeAdminError, splitRiotId } from "@/lib/admin-errors";

describe("admin error messages", () => {
  it("never surfaces parser or transport details", () => {
    expect(describeAdminError(new SyntaxError("Unexpected token <"), "sync").message).toBe(
      "Algo salió mal. Recarga la página e inténtalo de nuevo.",
    );
    expect(describeAdminError(new AdminRequestError(0, null), "add").message).toMatch(
      /No hay conexión/,
    );
    expect(
      describeAdminError(new AdminRequestError(500, "TypeError: x"), "add").message,
    ).not.toMatch(/TypeError/);
  });
  it("ties Riot ID problems to the Riot ID fields", () => {
    for (const status of [400, 404])
      expect(describeAdminError(new AdminRequestError(status, "x"), "add").field).toBe("riotId");
    const duplicate = describeAdminError(
      new AdminRequestError(409, "Esta cuenta ya está registrada (PUUID duplicado)."),
      "add",
    );
    expect(duplicate).toEqual({
      message: "Esa cuenta ya está en la clasificación.",
      field: "riotId",
    });
  });
  it("ties login failures to the password field", () => {
    expect(
      describeAdminError(new AdminRequestError(401, "Contraseña incorrecta."), "login").field,
    ).toBe("password");
    expect(describeAdminError(new AdminRequestError(401, null), "sync").field).toBeUndefined();
  });
  it("keeps useful server messages for busy or rate-limited syncs", () => {
    expect(
      describeAdminError(new AdminRequestError(409, "Ya hay una sincronización en curso."), "sync")
        .message,
    ).toBe("Ya hay una sincronización en curso.");
    const limited = "Jugador añadido. Riot ha limitado la sincronización; continuará más tarde.";
    expect(describeAdminError(new AdminRequestError(503, limited), "add").message).toBe(limited);
  });
});

describe("Riot ID splitting", () => {
  it("splits a full Riot ID typed into the name field", () => {
    expect(splitRiotId("Faker#KR1")).toEqual({ gameName: "Faker", tagLine: "KR1" });
    expect(splitRiotId(" Demo Nebula # LAS ")).toEqual({ gameName: "Demo Nebula", tagLine: "LAS" });
    expect(splitRiotId("Faker")).toBeNull();
  });
});
