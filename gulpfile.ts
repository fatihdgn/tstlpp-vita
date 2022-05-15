import os from "os";
import gulp from "gulp";
import fs from "fs";
import del from "del";
import { execSync } from "child_process";
import zip from "gulp-zip";
import merge from "merge-stream";
import { src } from "gulp";
import rename from "gulp-rename";
import filter from "gulp-filter";
import { Client } from "basic-ftp";
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
const logger: (message: any) => void = console.log;

function init(configurationFilePath?: string) {
  ensureVitaMksfoexExists();
  config = readConfiguration(
    configurationFilePath ?? defaults.projectConfigurationFilePath
  );
  validateConfiguration(config);
}

function readConfiguration(filePath: string): IVitaProjectConfiguration {
  logger("Reading configuration...");
  if (!fs.existsSync(filePath)) throw errors.projectConfigFileIsMissing;
  let vitaProjectConfig = Object.assign(
    defaults.config,
    JSON.parse(fs.readFileSync(filePath, "utf-8"))
  );
  logger("Configuration readed successfully.");
  return vitaProjectConfig;
}

function ensureEbootFileExists(config: IVitaProjectConfiguration) {
  if (
    !fs.existsSync(
      `${config.systemDir}/eboot_${config.type}.bin`
    )
  )
    throw errors.ebootFileIsMissing;
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

function validateIp(ip ?: string) {
  if (!!ip)
    throw errors.ipIsNotDefined;
}


function ensureVitaMksfoexExists() {
  const tempSfoPath = `${os.tmpdir()}/temp.sfo`
  try { execSync(`vita-mksfoex -s TITLE_ID=HELLOWRLD "HELLO" ${tempSfoPath}`); }
  catch { throw errors.vitaMksfoexDoesntExists; }
  finally { del(tempSfoPath, { force: true }); }
}

function generateNetcatClient(config: IVitaProjectConfiguration): typeof NetcatClient {
  if (config.ip == null) throw errors.ipIsNotDefined;
  return new NetcatClient()
    .addr(config.ip)
    .port(config.ports?.cmd ?? defaults.config.ports?.cmd ?? 1338)
    .retry(5000);
}

function sendCmdAsync(config: IVitaProjectConfiguration, cmd: string) {
  return new Promise<void>((resolve, reject) => {
    let nc: typeof NetcatClient;
    try {
      nc = generateNetcatClient(config);
    } catch (error) {
      reject(error);
    }
    nc.on("error", reject)
      .connect()
      .send(cmd + "\n", () => {
        nc.close(() => {
          resolve();
        });
      });
  });
}

async function connectAndSendFileFromFtpAsync(config: IVitaProjectConfiguration) {
  if (config.ip == null) throw errors.ipIsNotDefined;
  if (config.id.length !== consts.idLength)
    throw errors.idDoesNotConformRequirements;
  let ftp = new Client();
  logger("Connecting to FTP server...");
  await ftp.access({
    host: config.ip,
    port: config.ports?.ftp ?? defaults.config.ports?.ftp ?? 1337,
  });
  logger("Connected to FTP server.");
  logger("Listing directories");
  logger(await ftp.list());
  logger("Going to ux0: directory");
  await ftp.cd("ux0:");
  logger("Going to app directory");
  await ftp.cd("app");
  logger(`Going to ${config.id} directory`);
  await ftp.cd(config.id);
  logger("Uploading file...");

  await ftp.uploadFrom("./assets/100x100.png", "100x100.png");
  logger("File uploaded.");
  logger("Closing connection.");
  ftp.close();
  logger("Connection closed");
}

async function clearTempDirectoryAsync(config: IVitaProjectConfiguration) {
  logger("Clearing temp directory...");
  if (config.tempDir) {
    await del(config.tempDir);
    logger("Temp directory cleared.");
  } else throw "FATAL ERROR: Temp directory is not defined...";
}

async function clearDirectoryAsync(dir: string): Promise < boolean > {
  if(!!dir) {
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
  return gulp.src(sfoFilePath).pipe(rename("sce_sys/param.sfo"));
}

function sourceFiles(config: IVitaProjectConfiguration) {
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
  compileSourceFiles();
  return projectFiles(config)
    .pipe(zip(`${config.title}.vpk`))
    .pipe(
      gulp.dest(config.outDir ?? defaults.config.outDir ?? "dist")
    );
}

async function deployAsync(config: IVitaProjectConfiguration) {
  validateIp(config.ip);

  compileSourceFiles();
  let tempDir = config.tempDir;
  logger("Bundling project files to temp directory.");
  await toPromise(projectFiles(config).pipe(gulp.dest(tempDir)));
  logger("Files bundled.");
  logger("Closing applications just in case.");
  await sendCmdAsync(config, "destroy");
  let ftp = new Client();
  logger("Connecting to FTP server...");
  await ftp.access({
    host: config.ip ?? "localhost",
    port: config.ports?.ftp ?? defaults.config.ports?.ftp ?? defaults.config.ports.ftp,
  });
  logger("Connected to FTP server.");
  logger("Listing directories");
  logger(await ftp.list());
  logger("Going to ux0: directory");
  await ftp.cd("ux0:");
  logger("Going to app directory");
  await ftp.cd("app");
  logger(`Going to ${config.id} directory`);
  await ftp.cd(config.id);
  logger("Uploading files...");
  await ftp.uploadFromDir(tempDir);
  logger("Files uploaded.");
  logger("Closing connection.");
  ftp.close();
  logger("Connection closed");
  logger("Clearing temp directory");
  await clearTempDirectoryAsync(config);
  logger("Cleared temp directory.");
}


gulp.task("default", async () => {
  init();
  build(config);
});
gulp.task("build", async () => {
  init();
  build(config);
});

gulp.task("test:cmd", async () => {
  init();
  logger("Launching application...");
  await sendCmdAsync(config, `launch ${config.id}`);
  logger("Application launched.");
  logger("Waiting two seconds.");
  await sleepAsync(2000);
  logger("Destroying applications...");
  await sendCmdAsync(config, "destroy");
  logger("Applications destroyed.");
});

gulp.task("deploy", async () => {
  init();
  await deployAsync(config);
});

gulp.task("watch", async () => {
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
