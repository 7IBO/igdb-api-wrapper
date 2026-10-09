// ISO 3166-1 numeric codes (IGDB's `companies.country` and `external_games.countries`) and their
// alpha-2 codes, which `Intl.DisplayNames` reads. From Debian's iso-codes 4.16 (249 countries).
const isoCountries =
  "4AF 8AL 10AQ 12DZ 16AS 20AD 24AO 28AG 31AZ 32AR 36AU 40AT 44BS 48BH 50BD 51AM 52BB 56BE 60BM " +
  "64BT 68BO 70BA 72BW 74BV 76BR 84BZ 86IO 90SB 92VG 96BN 100BG 104MM 108BI 112BY 116KH 120CM 124CA " +
  "132CV 136KY 140CF 144LK 148TD 152CL 156CN 158TW 162CX 166CC 170CO 174KM 175YT 178CG 180CD 184CK " +
  "188CR 191HR 192CU 196CY 203CZ 204BJ 208DK 212DM 214DO 218EC 222SV 226GQ 231ET 232ER 233EE 234FO " +
  "238FK 239GS 242FJ 246FI 248AX 250FR 254GF 258PF 260TF 262DJ 266GA 268GE 270GM 275PS 276DE 288GH " +
  "292GI 296KI 300GR 304GL 308GD 312GP 316GU 320GT 324GN 328GY 332HT 334HM 336VA 340HN 344HK 348HU " +
  "352IS 356IN 360ID 364IR 368IQ 372IE 376IL 380IT 384CI 388JM 392JP 398KZ 400JO 404KE 408KP 410KR " +
  "414KW 417KG 418LA 422LB 426LS 428LV 430LR 434LY 438LI 440LT 442LU 446MO 450MG 454MW 458MY 462MV " +
  "466ML 470MT 474MQ 478MR 480MU 484MX 492MC 496MN 498MD 499ME 500MS 504MA 508MZ 512OM 516NA 520NR " +
  "524NP 528NL 531CW 533AW 534SX 535BQ 540NC 548VU 554NZ 558NI 562NE 566NG 570NU 574NF 578NO 580MP " +
  "581UM 583FM 584MH 585PW 586PK 591PA 598PG 600PY 604PE 608PH 612PN 616PL 620PT 624GW 626TL 630PR " +
  "634QA 638RE 642RO 643RU 646RW 652BL 654SH 659KN 660AI 662LC 663MF 666PM 670VC 674SM 678ST 682SA " +
  "686SN 688RS 690SC 694SL 702SG 703SK 704VN 705SI 706SO 710ZA 716ZW 724ES 728SS 729SD 732EH 740SR " +
  "744SJ 748SZ 752SE 756CH 760SY 762TJ 764TH 768TG 772TK 776TO 780TT 784AE 788TN 792TR 795TM 796TC " +
  "798TV 800UG 804UA 807MK 818EG 826GB 831GG 832JE 833IM 834TZ 840US 850VI 854BF 858UY 860UZ 862VE " +
  "876WF 882WS 887YE 894ZM";

let byNumber: Map<number, string> | undefined;
let byLetters: Map<string, number> | undefined;

function tables(): [Map<number, string>, Map<string, number>] {
  if (!byNumber || !byLetters) {
    byNumber = new Map();
    byLetters = new Map();
    for (const entry of isoCountries.split(" ")) {
      const code = Number(entry.slice(0, -2));
      const letters = entry.slice(-2);
      byNumber.set(code, letters);
      byLetters.set(letters, code);
    }
  }
  return [byNumber, byLetters];
}

/** The alpha-2 code of an ISO 3166-1 numeric code: `"FR"` for 250. Undefined when unknown. */
export function alpha2(code: number): string | undefined {
  return tables()[0].get(code);
}

/** The ISO 3166-1 numeric code of an alpha-2 code: 250 for `"FR"`. Undefined when unknown. */
export function numericCountry(letters: string): number | undefined {
  return tables()[1].get(letters.toUpperCase());
}
