import { test } from "node:test";
import { strict as assert } from "node:assert";
import { classifyBusinessCard } from "../src/ocr.ts";

const cards: Array<[string, Record<string, string>]> = [
  [
    `CONOSHIP\nINTERNATIONAL\nCONOSHIP INTERNATIONAL POLAND SP.Z O.O.\nGDANSK, POLAND\nul. ptk. Jana Patubickiego 6\n80-175 Gdask\nPoland\nAgnieszka Kosciowska MSc\na.kosciowska@conoship.com\nManaging Director /Naval\nwww.conoship.com\nArchitect\n+48 698144077\nNIP: 9571127885, REGON: 387341681, KRS: 0000865148`,
    {
      first_name: "Agnieszka",
      last_name: "Kosciowska",
      position: "Managing Director / Naval Architect",
      phone: "+48 698144077",
      email: "a.kosciowska@conoship.com",
      website: "www.conoship.com",
      company: "CONOSHIP INTERNATIONAL POLAND SP.Z O.O.",
    },
  ],
  [
    `ТОВ «МОРСЬКІ СИСТЕМИ»\nПЕТРЕНКО Олександр Іванович\nКомерційний директор\nвул. Пушкінська 12, оф. 5\n65026 Одеса, Україна\nТел.: +380 48 123 45 67\nМоб.: +380 67 765 43 21\nФакс: +380 48 123 45 68\no.petrenko@marsys.com.ua\nЄДРПОУ 12345678`,
    {
      first_name: "Олександр",
      last_name: "Петренко",
      position: "Комерційний директор",
      phone: "+380 67 765 43 21; +380 48 123 45 67",
      email: "o.petrenko@marsys.com.ua",
      company: "ТОВ «МОРСЬКІ СИСТЕМИ»",
    },
  ],
  [
    `Dr. Hans-Peter MÜLLER\nHead of Technical Services\nNordwind Shipping GmbH\nHafenstraße 21, 20457 Hamburg\nT: +49 40 1234 5678 | M: +49 171 2345678\nE: hp.mueller@nordwind-shipping.de\nnordwind-shipping.de`,
    {
      first_name: "Hans-Peter",
      last_name: "Müller",
      position: "Head of Technical Services",
      phone: "+49 171 2345678; +49 40 1234 5678",
      email: "hp.mueller@nordwind-shipping.de",
      website: "nordwind-shipping.de",
      company: "Nordwind Shipping GmbH",
    },
  ],
  [
    `NORDHAVdesign\nKari Nordmann Olsen\nMob. +47 48152925\nVice President Sales\nOffice. +47 70 08 01 80\nNordhav Design AS\nkno@nordhavdesign.no`,
    {
      first_name: "Kari",
      last_name: "Nordmann Olsen",
      position: "Vice President Sales",
      phone: "+47 48152925; +47 70 08 01 80",
      email: "kno@nordhavdesign.no",
      company: "Nordhav Design AS",
    },
  ],
  [
    `Ola Fjordvik\nSiv.ing. skip og marin teknologi\nDaglig leder\nFjordvik Marine sp. z 0.o.\nEl Puerto (Cantabria) SPAIN\nola@fjordvik.no\n+47 9008 2899`,
    {
      first_name: "Ola",
      last_name: "Fjordvik",
      position: "Daglig leder",
      phone: "+47 9008 2899",
      email: "ola@fjordvik.no",
      company: "Fjordvik Marine sp. z 0.o.",
    },
  ],
  [
    `ACMEPIPE\nPiping systems & HVAC solutions\nPipe Spool Fabrication\nship design · engineering • consultancy\n(135 / 136 / 138 / 141\nwww.acmepipe.eu`,
    { website: "www.acmepipe.eu", company: "ACMEPIPE" },
  ],
  [
    `BLUE ANCHOR\nE. Kowalski\nOwner\ne.kowalski@gmail.com\n+48 600 100 200`,
    {
      first_name: "E.",
      last_name: "Kowalski",
      position: "Owner",
      phone: "+48 600 100 200",
      email: "e.kowalski@gmail.com",
      company: "BLUE ANCHOR",
    },
  ],
  [
    `GÜTEBORG|SWEDEN TRIESTE|ITALY BARCELONA|SPAIN\nNAOS-BCN\nJose Luis Linares Llamas\nSHUPANO BOAT DESAGN\nTechnical Director | NAOS Ship & Boat Design\n+34 633 26 31\n08870,Carrer San Sebastia\nTel:\nBarcelona, Spain\nAddress\njl.linares@naos-bcn.com\nWebsite: www.naos-bcn.com\nEmail:\nEscola dEnginyeria de Barcelona Est - EEBE1 Alumnus`,
    {
      first_name: "Jose Luis",
      last_name: "Linares Llamas",
      position: "Technical Director | NAOS Ship & Boat Design",
      phone: "+34 633 26 31",
      email: "jl.linares@naos-bcn.com",
      website: "www.naos-bcn.com",
      company: "NAOS-BCN",
    },
  ],
];
for (const [index, [source, expected]] of cards.entries())
  test(`OCR reference card ${index + 1}`, () => {
    const actual = { ...classifyBusinessCard(source).draft };
    delete actual.address;
    assert.deepEqual(actual, expected);
  });

test("OCR labels multi-office headers and strips address labels", () => {
  const result =
    classifyBusinessCard(`GÖTEBORG | SWEDEN TRIESTE | ITALY BARCELONA SPAIN
NAOS-BCN
SHUP AND BOAT DESIGN
Jose Luis Linares Llamas
Technical Director | NAOS Ship & Boat Design
+34 633 26 31
Tel:
Address: 08870, Carrer San Sebastià,
Barcelona, Spain
Email: jl.linares@naos-bcn.com
Website: www.naos-bcn.com`);
  assert.equal(result.lines[0]?.type, "offices");
  assert.equal(
    result.draft.address,
    "08870, Carrer San Sebastià, Barcelona, Spain",
  );
});
