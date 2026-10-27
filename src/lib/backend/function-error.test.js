import test from "node:test";
import assert from "node:assert/strict";
import { functionErrorMessage } from "./function-error.js";

test("reads the safe JSON error returned by an Edge Function", async () => {
  const error = {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify({ error: "Invalid invitation redirect." }), { status: 400 }),
  };
  assert.equal(await functionErrorMessage(error), "Invalid invitation redirect.");
});

test("uses the HTTP status when the Edge Function response is not JSON", async () => {
  const error = {
    name: "FunctionsHttpError",
    context: new Response("upstream failure", { status: 502 }),
  };
  assert.equal(await functionErrorMessage(error), "The account function returned HTTP 502. Check the Supabase function logs for details.");
});

test("does not reinterpret network failures as HTTP errors", async () => {
  assert.equal(await functionErrorMessage({ name: "FunctionsFetchError" }), "");
});
