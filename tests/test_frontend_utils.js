"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { srtToVtt } = require("../static/utils.js");

test("srtToVtt converts BOM, CRLF and comma timestamps", () => {
  const source = "\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n字幕内容\r\n";
  assert.equal(
    srtToVtt(source),
    "WEBVTT\n\n1\n00:00:01.250 --> 00:00:03.500\n字幕内容\n"
  );
});
