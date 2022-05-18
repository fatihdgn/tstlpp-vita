import os from "os";
import fs from "fs";
import del from "del";
import { execSync } from "child_process";
import zip from "gulp-zip";
import merge from "merge-stream";
import { src, dest, task, watch, series } from "gulp";
import rename from "gulp-rename";
import filter from "gulp-filter";
import { AccessOptions, Client } from "basic-ftp";
const pngquant = require("gulp-pngquant");
const NetcatClient = require("netcat/client");

interface IVitaProjectConfiguration {
  id: string;
  title: string;
  type: 'safe' | 'unsafe' | 'unsafe_sys',
  ip?: string;
  ports: { ftp: number; cmd: number };
  systemDir: string;
  sourceDir: string;
  tempDir: string;
  outDir: string;
  files: Array<string>;
}

const defaults = {
  projectConfigurationFilePath: "./vita-project.json",
  ebootFileNames: {
    original: "eboot.bin",
    safe: "eboot_safe.bin",
    unsafe: "eboot_unsafe.bin",
    unsafe_sys: "eboot_unsafe_sys.bin"
  },
  config: <IVitaProjectConfiguration>{
    id: "",
    title: "",
    type: 'safe',
    ports: {
      ftp: 1337,
      cmd: 1338,
    },
    systemDir: "system",
    sourceDir: "out-src",
    tempDir: ".temp",
    outDir: "dist",
    files: ["*assets/**/*"],
  },
};

const consts = {
  idLength: 9
};

const errors = {
  projectConfigFileIsMissing: "vita-project.json file is missing. It's required for the build process.",
  idDoesNotConformRequirements: "'id' is not defined or does not conform the requirements. It must be exactly 9 characters long.",
  titleIsNotAvailable: "'title' is not available.",
  typeIsNotValid: 'Type is not valid. It must be either \'safe\',\'unsafe\' or \'unsafe_sys\'.',
  ebootFileIsMissing: "eboot file is missing. Make sure you have the eboot_safe.bin, eboot_unsafe.bin and eboot_unsafe_sys.bin files at the system directory. You can get them from 'https://github.com/Rinnegatamante/lpp-vita/releases/latest'.",
  vitaMksfoexDoesntExists: "vita-mksfoex doesn't exists. Make sure that you installed Vita SDK or have the vita-mksfoex in your system environment. You can get the SDK from 'https://vitasdk.org/'.",
  ipIsNotDefined: "'ip' is not defined inside project file and not sent from connect call."
};

async function sleepAsync(ms: number) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms));
}
function toPromise(stream: NodeJS.ReadWriteStream) {
  return new Promise((resolve, reject) => {
    stream.on("error", reject).on("end", resolve);
  });
}

let config: IVitaProjectConfiguration;
let logger: (message: any) => void = console.log;

function init(configurationFilePath?: string) {
  if (!!configurationFilePath) configurationFilePath = defaults.projectConfigurationFilePath;
  ensureVitaMksfoexExists();
  config = readConfiguration(
    configurationFilePath ?? defaults.projectConfigurationFilePath
  );
  validateConfiguration(config);
}
function readConfiguration(filePath: string): IVitaProjectConfiguration {
  logger("Reading configuration...");
  if (!fs.existsSync(filePath)) throw errors.projectConfigFileIsMissing;
  let vitaProjectConfig = Object.assign({}, defaults.config, JSON.parse(fs.readFileSync(filePath, "utf-8")));
  logger("Configuration readed successfully.");
  return vitaProjectConfig;
}
function ensureEbootFileExists(config: IVitaProjectConfiguration) {
  logger(`Ensuring the ${config.type} eboot file exists.`);
  if (
    !fs.existsSync(
      `${config.systemDir}/eboot_${config.type}.bin`
    )
  )
    throw errors.ebootFileIsMissing;
  logger("Eboot file is ensured.");
}
function validateConfiguration(config: IVitaProjectConfiguration, ensureEbootFile: boolean = true) {
  logger("Validating configuration...");
  validateId(config.id);
  validateTitle(config.title);
  validateType(config.type);
  if (ensureEbootFile) ensureEbootFileExists(config);
  logger("Configuration has no errors.");
}
function validateId(id: string) {
  if (id.length !== consts.idLength)
    throw errors.idDoesNotConformRequirements;
}
function validateTitle(title: string) {
  if (title.length === 0)
    throw errors.titleIsNotAvailable;
}
function validateType(type: string) {
  if (type !== 'safe' && type !== 'unsafe' && type !== 'unsafe_sys')
    throw errors.typeIsNotValid
}
function validateIp(ip?: string) {
  if (!ip) throw errors.ipIsNotDefined;
}
function ensureVitaMksfoexExists() {
  const tempSfoPath = `${os.tmpdir()}/temp.sfo`
  try { execSync(`vita-mksfoex -s TITLE_ID=HELLOWRLD "HELLO" ${tempSfoPath}`); }
  catch { throw errors.vitaMksfoexDoesntExists; }
  finally { del(tempSfoPath, { force: true }); }
}

function generateNetcatClient(config: IVitaProjectConfiguration): typeof NetcatClient {
  validateIp(config.ip);
  return new NetcatClient()
    .addr(config.ip)
    .port(config.ports?.cmd ?? defaults.config.ports?.cmd ?? 1338)
    .retry(5000);
}

function sendCommandViaNetcatAsync(client: typeof NetcatClient, command: string) {
  return new Promise<void>((resolve, reject) => {
    client
      .on("error", reject)
      .connect()
      .send(command + "\n", () => {
        client.close(() => {
          resolve();
        });
      });
  })
}

function createCommander(config: IVitaProjectConfiguration) {
  let createClient = () => generateNetcatClient(config);
  return {
    createClient,
    launchAsync: async () => {
      await sendCommandViaNetcatAsync(createClient(), `launch ${config.id}`);
    },
    destroyAsync: async () => {
      await sendCommandViaNetcatAsync(createClient(), "destroy");
    },
    rebootAsync: async () => {
      await sendCommandViaNetcatAsync(createClient(), "reboot");
    },
    screenAsync: async (state: "on" | "off") => {
      await sendCommandViaNetcatAsync(createClient(), `screen ${state}`);
    }
  }
}

function createFtpAccessOptionsFromConfig(config: IVitaProjectConfiguration): AccessOptions {
  validateIp(config.ip);
  return {
    host: config.ip,
    port: config.ports?.ftp ?? defaults.config.ports?.ftp,
  }
}

async function connectToAppDirectoryViaFtp(config: IVitaProjectConfiguration) {
  validateIp(config.ip);
  validateId(config.id)
  let client = new Client();
  logger("Connecting to FTP server...");
  await client.access(createFtpAccessOptionsFromConfig(config));
  logger("Connected to FTP server.");
  logger("Going into ux0: directory");
  await client.cd("ux0:");
  logger("Going into app directory");
  await client.cd("app");
  logger(`Going to ${config.id} directory`);
  await client.cd(config.id);
  return {
    config,
    client,
    disconnect: function () {
      logger("Closing connection.");
      client.close();
      logger("Connection closed");
    }
  };
}

async function clearTempDirectoryAsync(config: IVitaProjectConfiguration) {
  logger("Clearing temp directory...");
  if (config.tempDir) {
    await del(config.tempDir);
    logger("Temp directory cleared.");
  } else throw "FATAL ERROR: Temp directory is not defined...";
}

async function clearDirectoryAsync(dir: string): Promise<boolean> {
  if (!!dir) {
    await del(`${dir}/**/*`);
    return true;
  }
  return false;
}

async function clearOutDirectoryAsync(config: IVitaProjectConfiguration) {
  logger("Clearing out directory...");

  if (!clearDirectoryAsync(config.outDir)) {
    throw "FATAL ERROR: Out directory is not defined...";
  }

  logger("Out directory cleared.");
}

function compileSourceFiles() {
  logger("Compiling source files...");
  execSync("npx tstl");
  logger("Compile completed.");
}

function generateSfoFile(config: IVitaProjectConfiguration, path: string) {
  logger(`Generating sfo file to path: ${path}`);
  execSync(
    `vita-mksfoex -s TITLE_ID=${config.id} "${config.title}" ${path}`
  );
  logger("Sfo file generated.");
}
function generatedSfoFile(config: IVitaProjectConfiguration) {
  let sfoFilePath = `${os.tmpdir()}/param.sfo`;
  generateSfoFile(config, sfoFilePath);
  return src(sfoFilePath).pipe(rename("sce_sys/param.sfo"));
}

function sourceFiles(config: IVitaProjectConfiguration) {
  compileSourceFiles();
  logger("Bundling source files...");
  return src(
    `${config.sourceDir}/**/*`
  );
}

function additionalFiles(config: IVitaProjectConfiguration) {
  logger("Bundling additional files.");
  return src(config.files);
}

function systemFiles(config: IVitaProjectConfiguration) {
  logger("Bundling system files.");
  return src([
    `${config.systemDir}/**/*`,
    `!${config.systemDir}/${defaults.ebootFileNames.safe}`,
    `!${config.systemDir}/${defaults.ebootFileNames.unsafe}`,
    `!${config.systemDir}/${defaults.ebootFileNames.unsafe_sys}`,
  ]);
}

function processedFiles(config: IVitaProjectConfiguration) {
  logger("Processing system and additional files.");
  let f = filter(["**/*.{bmp,png,jpg}"], { restore: true });
  return merge(systemFiles(config), additionalFiles(config))
    .pipe(f)
    .pipe(pngquant())
    .pipe(f.restore);
}

function ebootFile(config: IVitaProjectConfiguration) {
  logger(`Bundling ${config.type} eboot file...`);
  return src(`${config.systemDir}/eboot_${config.type}.bin`).pipe(rename(defaults.ebootFileNames.original));
}

function projectFiles(config: IVitaProjectConfiguration) {
  logger("Assembling project files...");
  return merge(
    generatedSfoFile(config),
    ebootFile(config),
    sourceFiles(config),
    processedFiles(config)
  );
}

function build(config: IVitaProjectConfiguration) {
  return projectFiles(config)
    .pipe(zip(`${config.title}.vpk`))
    .pipe(dest(config.outDir));
}

async function uploadTempDirAsync(config: IVitaProjectConfiguration, clearAfterUpload: boolean = true, launchAppAfterUpload: boolean = false) {
  validateId(config.id);
  validateIp(config.ip);

  logger("Closing applications");
  var commander = createCommander(config);
  await commander.destroyAsync();
  logger("Applications closed");

  var connection = await connectToAppDirectoryViaFtp(config);
  logger("Uploading files...");
  let tempDir = config.tempDir;
  await connection.client.uploadFromDir(tempDir);
  logger("Files uploaded.");
  connection.disconnect();
  if (launchAppAfterUpload) {
    logger("Opening application.");
    await commander.launchAsync();
    logger("Application opened.");
  }
  if (clearAfterUpload) {
    logger("Clearing temp directory");
    await clearTempDirectoryAsync(config);
    logger("Cleared temp directory.");
  }
}

async function deployAsync(config: IVitaProjectConfiguration) {
  validateId(config.id);
  validateIp(config.ip);

  let tempDir = config.tempDir;
  logger("Bundling project files to temp directory.");
  await toPromise(projectFiles(config).pipe(dest(tempDir)));
  logger("Files bundled.");

  await uploadTempDirAsync(config, true, true);
}

task("default", async () => {
  init();
  build(config);
});

task("build", async () => {
  init();
  build(config);
});

task("deploy", async () => {
  init();
  await deployAsync(config);
});

task("watch", async () => {
  init();
  watch(["src/**/*", ...config.files], series(['deploy'])); // Redeploy works fine, and it's not that slow, for now...
  /* TODO: Implement watch logic.
    Connect to device.
    Send the open application command. 
    Watch for the file changes inside project files.
      If it's a source file change, compile it or if it's a configuration file related change and if it's an image file, then process it.
      Close the application if it's opened.
      Connect to device through an FTP connection.
      Send these processed files to application directory via FTP.
      Close the FTP connection.
      Open the app again.
    Keep doing this until the process stops.
  */
  // I will be looking into this some time later because file watch partially works on WSL.
  // https://github.com/microsoft/WSL/issues/216
});
