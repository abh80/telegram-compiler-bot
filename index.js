import Docker from "dockerode";

import TelegramBot from "node-telegram-bot-api";

import dotenv from "dotenv";

dotenv.config();

const langConfig = [
  {
    language: "java",
    getCommand: (file) => `java ${file}`,
    ext: ".java",
    image: "openjdk",
  },
  {
    language: "python",
    getCommand: (file) => `python ${file}`,
    ext: ".py",
    image: "python",
  },
  {
    language: "c",
    getCommand: (file) =>
      `gcc -o ${file.split(".")[0]} ${file} && ${file.split(".")[0]}`,
    ext: ".c",
    image: "gcc",
  },
  {
    language: "js",
    getCommand: (file) => `node ${file}`,
    ext: ".js",
    image: "node",
  },
];
let parentConfig = [
  {
    language: "java",
    getCode: (code) => `public class Code{
            public static void main(String[] args){
                ${code}
            }
        }`,
  },
  {
    language: "c",
    getCode: (code) => `#include <stdio.h>
    int main() {
    ${code}
    return 0;
    }`,
  },
];
async function main() {
  const bot = new TelegramBot(process.env["token"], { polling: true });
  bot.onText(/\/code (.+)/s, async (msg, match) => {
    const regex = /^(\w+)\s+(.*?)(?:\s+--parent)?$/s;
    const chatId = msg.chat.id;
    const resp = match[1];

    if (!resp.trim() || !regex.test(resp))
      return bot.sendMessage(
        chatId,
        "❌ Invalid Format, please send your code in this format -> /code [java] [code]"
      );
    const matches = resp.match(regex);
    let lang = matches[1];
    let code = matches[2];
    let hasParent;
    if (
      matches[0].includes("--parent") &&
      parentConfig.find((x) => x.language == lang.toLowerCase())
    )
      hasParent = true;

    const validLangs = langConfig.map((x) => x.language);
    if (!lang || !code) return bot.sendMessage(chatId, "Cant evaluate it");
    if (!validLangs.includes(lang.toLowerCase()))
      return bot.sendMessage(
        chatId,
        `${lang} is not a supported language. Please use any of these ${validLangs.join(
          ", "
        )}`
      );
    const res = await runCode(code, lang, hasParent);
    return bot.sendMessage(chatId, res);
  });
}

async function runCode(code, language, parent) {
  const docker = new Docker();
  const config = langConfig.find((x) => x.language == language);
  if (!config) return "❌ Fatal Error occured by parsing the code";

  const container = await docker.createContainer({
    Image: config.image,
    Tty: true,
    OpenStdin: true,
    HostConfig: {
      AutoRemove: true,
    },
  });

  await container.start();
  if (parent)
    code = parentConfig
      .find((x) => x.language == config.language)
      .getCode(code);
  const encodedCode = Buffer.from(code).toString("base64");
  const exec = await container.exec({
    Cmd: [
      "bash",
      "-c",
      `mkdir /app/ && echo "${encodedCode}" | base64 --decode > /app/code.${
        config.ext
      } && ${config.getCommand(`/app/code.${config.ext}`)}`,
    ],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start();
  let outputData = "";
  stream.on("data", (chunk) => {
    outputData += chunk.toString();
  });
  await new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  await container.stop();
  return outputData;
}

main();
