import test from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, safeDomainList, validEmail } from "../src/security.js";

test("email validation accepts normal addresses and rejects malformed input", () => {
  assert.equal(validEmail("person@example.com"), true);
  assert.equal(validEmail("bad address"), false);
  assert.equal(validEmail("x@example"), false);
  assert.equal(validEmail(""), false);
});

test("domain list is normalized", () => {
  assert.deepEqual(safeDomainList(" Example.com,mail.example.com ,, "), ["example.com", "mail.example.com"]);
});

test("constant time comparison handles equal and unequal strings", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});
