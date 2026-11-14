// The "enter your trip code" screen, shown once per phone.

import { join } from "../data/store";
import { $ } from "./dom";

/** Shows the screen and resolves when the right code was entered. */
export function askForTripCode(): Promise<void> {
  const el = document.createElement("div");
  el.className = "join";
  el.innerHTML = `
    <form class="join-card">
      <div class="seal" aria-hidden="true">旅</div>
      <h1>Japanchansky</h1>
      <p class="muted">Enter your trip code to see and edit your shared list. You only need to do this once on this phone.</p>
      <label class="sr-only" for="tripCode">Trip code</label>
      <input id="tripCode" type="password" autocomplete="current-password" placeholder="Trip code" required />
      <label class="show-code"><input type="checkbox" id="showCode" /> Show code</label>
      <button type="submit">Open our list</button>
      <p class="join-error" id="joinError" role="alert"></p>
    </form>`;
  document.body.append(el);
  const input = $<HTMLInputElement>("#tripCode", el);
  input.focus();
  // If no trip code was set on the server yet, say so (instead of "wrong code" later).
  fetch("./api/health")
    .then((r) => r.json())
    .then((h) => {
      if (!h.codeSet) $("#joinError", el).textContent = "No trip code has been set on the server yet (npm run hertz:set-code).";
    })
    .catch(() => {});
  $<HTMLInputElement>("#showCode", el).addEventListener("change", (e) => {
    input.type = (e.target as HTMLInputElement).checked ? "text" : "password";
  });

  return new Promise((resolve) => {
    el.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = el.querySelector<HTMLButtonElement>("button[type=submit]")!;
      const error = $("#joinError", el);
      button.disabled = true;
      button.textContent = "Checking…";
      error.textContent = "";
      try {
        if (await join(input.value)) {
          el.remove();
          resolve();
          return;
        }
        error.textContent = "That code isn't right. Check spaces between words and try again.";
      } catch {
        error.textContent = "Couldn't reach the database. Are you online?";
      }
      button.disabled = false;
      button.textContent = "Open our list";
    });
  });
}
