import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import unzipper from "unzipper";
import sax from "sax";
import iconv from "iconv-lite";
type AnyObject = Record<string, any>;

const ZIP_FILES = [
  "PRODAT_369147_1312247470.zip",
  "PRODAT_369147_1312233182.zip",
];

const SHOW_RECORDS = 5;

function getText(value: any): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  if (typeof value === "object") {
    if ("#text" in value) {
      return String(value["#text"]).trim();
    }

    if ("Value" in value) {
      return getText(value.Value);
    }
  }

  return null;
}

function printRecord(record: AnyObject, index: number) {
  console.log(`\n========== RECORD ${index} ==========`);

  const fields = [
    "SenderPrdCode",
    "ReceiverPrdCode",
    "ItemID",
    "ProductName",
    "VendorProdNum",
    "Brand",
    "ParentProdCode",
    "ParentProdGroup",
    "ProductCode",
    "ProductGroup",
    "RsCatalog",
    "UOM",
    "ItemsPerUOM",
    "ItemsPerUnit",
    "Multiplicity",
    "TNVED",
    "OKPD2",
    "MINPROM",
    "LabelledItemCHZ",
    "ProductGroupCHZ",
  ];

  for (const field of fields) {
    if (field in record) {
      console.log(`${field}:`, getText(record[field]) ?? record[field]);
    }
  }

  console.log("Поля записи:");
  console.log(Object.keys(record).join(", "));
}

function addValue(
  parent: AnyObject,
  key: string,
  value: any
) {
  if (parent[key] === undefined) {
    parent[key] = value;
    return;
  }

  if (Array.isArray(parent[key])) {
    parent[key].push(value);
    return;
  }

  parent[key] = [parent[key], value];
}

async function processXmlStream(
  stream: NodeJS.ReadableStream,
  xmlName: string,
  onRecord: (record: AnyObject) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    console.log(`\n--- XML: ${xmlName} ---`);

    const parser = sax.parser(true, {
      trim: true,
      normalize: false,
      lowercase: false,
      xmlns: false,
    });

    type NodeState = {
      name: string;
      object: AnyObject;
      text: string;
      hasSenderPrdCode: boolean;
    };

    const stack: NodeState[] = [];

    let totalRecords = 0;
    let currentText = "";

    parser.onerror = (error) => {
      reject(error);
    };

    parser.onopentag = (node) => {
      const state: NodeState = {
        name: node.name,
        object: {},
        text: "",
        hasSenderPrdCode: false,
      };

      stack.push(state);
      currentText = "";
    };

    parser.ontext = (text) => {
      currentText += text;

      if (stack.length > 0) {
        stack[stack.length - 1].text += text;
      }
    };

    parser.oncdata = (text) => {
      currentText += text;

      if (stack.length > 0) {
        stack[stack.length - 1].text += text;
      }
    };

    parser.onclosetag = (name) => {
      const state = stack.pop();

      if (!state) {
        return;
      }

      const text = state.text.trim();

      let value: any = text;

      if (value === "") {
        value = {};
      }

      if (stack.length > 0) {
        const parent = stack[stack.length - 1];

        if (name === "SenderPrdCode") {
          parent.hasSenderPrdCode = true;
        }

        addValue(parent.object, name, value);

        if (state.hasSenderPrdCode) {
          parent.hasSenderPrdCode = true;
        }
      }

      if (state.hasSenderPrdCode) {
        totalRecords++;

        onRecord(state.object);
      }

      currentText = "";
    };

        parser.onend = () => {
      console.log(
        `Найдено записей с SenderPrdCode: ${totalRecords.toLocaleString(
          "ru-RU"
        )}`
      );

      resolve(totalRecords);
    };

    stream.on("data", (chunk: Buffer) => {
    parser.write(iconv.decode(chunk, "win1251"));
    });

    stream.on("end", () => {
      parser.close();
    });

    stream.on("error", (error) => {
      reject(error);
    });
  });
}

async function processZip(
  zipPath: string,
  onRecord: (record: AnyObject) => void
): Promise<number> {
  console.log("\n========================================");
  console.log("ОБРАБОТКА ZIP");
  console.log("========================================");
  console.log("Файл:", zipPath);

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Файл не найден: ${zipPath}`);
  }

  const directory = await unzipper.Open.file(zipPath);

  const xmlEntries = directory.files.filter(
    (entry) =>
      !entry.path.endsWith("/") &&
      entry.path.toLowerCase().endsWith(".xml")
  );

  console.log(`XML-файлов внутри ZIP: ${xmlEntries.length}`);

  if (xmlEntries.length === 0) {
    throw new Error("В ZIP не найден XML-файл PRODAT.");
  }

  let totalRecords = 0;

  for (const entry of xmlEntries) {
    const stream = entry.stream();

    totalRecords += await processXmlStream(
      stream,
      entry.path,
      onRecord
    );
  }

  return totalRecords;
}

async function main() {
  console.log("========================================");
  console.log("PRODAT DRY RUN — 2 ZIP");
  console.log("========================================");

  const baseDir = process.cwd();

  const zipPaths = ZIP_FILES.map((file) =>
    path.resolve(baseDir, file)
  );

  console.log("\nБудут обработаны:");

  for (const zipPath of zipPaths) {
    console.log(" -", zipPath);
  }

  let totalRecords = 0;
  let shownRecords = 0;

  for (const zipPath of zipPaths) {
    const count = await processZip(zipPath, (record) => {
      totalRecords++;

      if (shownRecords < SHOW_RECORDS) {
        shownRecords++;
        printRecord(record, shownRecords);
      }
    });

    console.log(
      `Записей из этого ZIP: ${count.toLocaleString("ru-RU")}`
    );
  }

  console.log("\n========================================");
  console.log("ОБЩИЙ ИТОГ");
  console.log("========================================");
  console.log(
    `Всего записей из двух ZIP: ${totalRecords.toLocaleString(
      "ru-RU"
    )}`
  );
  console.log(`Показано записей: ${shownRecords}`);

  console.log("\nБАЗА ДАННЫХ НЕ ИЗМЕНЯЛАСЬ.");
}

main().catch((error) => {
  console.error("\nОШИБКА:");
  console.error(error);
  process.exit(1);
});