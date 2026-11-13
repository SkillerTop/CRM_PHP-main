import { test } from "node:test";
import { strict as assert } from "node:assert";
import { lookupCompanyWebsite } from "../src/company-lookup.ts";
import type { safeGet } from "../src/safe-http.ts";

test("website lookup reads structured company data and checks logo dimensions", async () => {
  const html = `<html><head><script type="application/ld+json">{
    "@context":"https://schema.org","@type":"Organization","name":"Example Marine",
    "description":"Ship design and consulting","logo":"/logo.png",
    "address":{"@type":"PostalAddress","streetAddress":"Harbor 12","postalCode":"10001",
      "addressLocality":"Gdansk","addressCountry":"Poland"}}
    </script></head><body></body></html>`;
  const logo = Buffer.alloc(40);
  Buffer.from("89504e470d0a1a0a", "hex").copy(logo);
  logo.writeUInt32BE(64, 16);
  logo.writeUInt32BE(64, 20);
  const getter: typeof safeGet = async (url) =>
    url.endsWith("logo.png")
      ? { url, status: 200, contentType: "image/png", body: logo }
      : { url, status: 200, contentType: "text/html", body: Buffer.from(html) };
  const result = await lookupCompanyWebsite("example.org", getter);
  assert.equal(result.website, "https://example.org");
  assert.equal(result.name, "Example Marine");
  assert.equal(result.description, "Ship design and consulting");
  assert.equal(result.address, "Harbor 12, 10001 Gdansk, Poland");
  assert.equal(result.city, "Gdansk");
  assert.equal(result.country, "Poland");
  assert.ok(result.logo_data_url?.startsWith("data:image/png;base64,"));
});
