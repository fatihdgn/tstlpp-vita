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

class VitaProject {
  constructor(
    configurationFilePath?: string,
    public logger: (message: any) => void = console.log // Verbose?
  ) {
    this.ensureVitaMksfoexExists();
    this.configuration = this.readConfiguration(
      configurationFilePath ?? defaults.projectConfigurationFilePath
    );
    this.validateConfiguration(this.configuration);
  }

  configuration: IVitaProjectConfiguration;

  private readConfiguration(filePath: string): IVitaProjectConfiguration {
    this.logger("Reading configuration...");
    if (!fs.existsSync(filePath)) throw errors.projectConfigFileIsMissing;
    let vitaProjectConfig = Object.assign(
      defaults.config,
      JSON.parse(fs.readFileSync(filePath, "utf-8"))
    );
    this.logger("Configuration readed successfully.");
    return vitaProjectConfig;
  }

  private validateConfiguration(config: IVitaProjectConfiguration, ensureEbootFileExists: boolean = true) {
    this.logger("Validating configuration...");
    this.validateId(config.id);
    this.validateTitle(config.title);
    this.validateType(config.type);
    if (ensureEbootFileExists) this.ensureEbootFileExists(config);
    this.logger("Configuration has no errors.");
  }
  private validateId(id: string) {
    if (id.length !== consts.idLength)
      throw errors.idDoesNotConformRequirements;
  }

  private validateTitle(title: string) {
    if (title.length === 0)
      throw errors.titleIsNotAvailable;
  }

  private validateType(type: string) {
    if (type !== 'safe' && type !== 'unsafe' && type !== 'unsafe_sys')
      throw errors.typeIsNotValid
  }

  private validateIp(ip?: string) {
    if (!!ip)
      throw errors.ipIsNotDefined;
  }


  private ensureVitaMksfoexExists() {
    const tempSfoPath = `${os.tmpdir()}/temp.sfo`
    try { execSync(`vita-mksfoex -s TITLE_ID=HELLOWRLD "HELLO" ${tempSfoPath}`); }
    catch { throw errors.vitaMksfoexDoesntExists; }
    finally { del(tempSfoPath, { force: true }); }
  }

  private ensureEbootFileExists(config: IVitaProjectConfiguration) {
    if (
      !fs.existsSync(
        `${config.systemDir}/eboot_${config.type}.bin`
      )
    )
      throw errors.ebootFileIsMissing;
  }

  generateNetcatClient(config: IVitaProjectConfiguration): typeof NetcatClient {
    if (config.ip == null) throw errors.ipIsNotDefined;
    return new NetcatClient()
      .addr(config.ip)
      .port(config.ports?.cmd ?? defaults.config.ports?.cmd ?? 1338)
      .retry(5000);
  }

  sendCmdAsync(config: IVitaProjectConfiguration, cmd: string) {
    return new Promise<void>((resolve, reject) => {
      let nc: typeof NetcatClient;
      try {
        nc = this.generateNetcatClient(config);
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

  async connectAndSendFileFromFtpAsync(config: IVitaProjectConfiguration) {
    if (config.ip == null) throw errors.ipIsNotDefined;
    if (config.id.length !== consts.idLength)
      throw errors.idDoesNotConformRequirements;
    let ftp = new Client();
    this.logger("Connecting to FTP server...");
    await ftp.access({
      host: config.ip,
      port: config.ports?.ftp ?? defaults.config.ports?.ftp ?? 1337,
    });
    this.logger("Connected to FTP server.");
    this.logger("Listing directories");
    this.logger(await ftp.list());
    this.logger("Going to ux0: directory");
    await ftp.cd("ux0:");
    this.logger("Going to app directory");
    await ftp.cd("app");
    this.logger(`Going to ${config.id} directory`);
    await ftp.cd(config.id);
    this.logger("Uploading file...");

    await ftp.uploadFrom("./assets/100x100.png", "100x100.png");
    this.logger("File uploaded.");
    this.logger("Closing connection.");
    ftp.close();
    this.logger("Connection closed");
  }

  async clearTempDirectoryAsync(config: IVitaProjectConfiguration) {
    this.logger("Clearing temp directory...");
    if (config.tempDir) {
      await del(config.tempDir);
      this.logger("Temp directory cleared.");
    } else throw "FATAL ERROR: Temp directory is not defined...";
  }

  async clearDirectoryAsync(dir: string): Promise<boolean> {
    if (!!dir) {
      await del(`${dir}/**/*`);
      return true;
    }
    return false;
  }

  async clearOutDirectoryAsync(config: IVitaProjectConfiguration) {
    this.logger("Clearing out directory...");

    if (!this.clearDirectoryAsync(config.outDir)) {
      throw "FATAL ERROR: Out directory is not defined...";
    }

    this.logger("Out directory cleared.");
  }

  compileSourceFiles() {
    this.logger("Compiling source files...");
    execSync("npx tstl");
    this.logger("Compile completed.");
  }

  generateSfoFile(config: IVitaProjectConfiguration, path: string) {
    this.logger(`Generating sfo file to path: ${path}`);
    execSync(
      `vita-mksfoex -s TITLE_ID=${config.id} "${config.title}" ${path}`
    );
    this.logger("Sfo file generated.");
  }
  generatedSfoFile(config: IVitaProjectConfiguration) {
    let sfoFilePath = `${os.tmpdir()}/param.sfo`;
    this.generateSfoFile(config, sfoFilePath);
    return gulp.src(sfoFilePath).pipe(rename("sce_sys/param.sfo"));
  }

  sourceFiles(config: IVitaProjectConfiguration) {
    this.logger("Bundling source files...");
    return src(
      `${config.sourceDir}/**/*`
    );
  }

  additionalFiles(config: IVitaProjectConfiguration) {
    this.logger("Bundling additional files.");
    return src(config.files);
  }

  systemFiles(config: IVitaProjectConfiguration) {
    this.logger("Bundling system files.");
    return src([
      `${config.systemDir}/**/*`,
      `!${config.systemDir}/${defaults.ebootFileNames.safe}`,
      `!${config.systemDir}/${defaults.ebootFileNames.unsafe}`,
      `!${config.systemDir}/${defaults.ebootFileNames.unsafe_sys}`,
    ]);
  }

  processedFiles(config: IVitaProjectConfiguration) {
    this.logger("Processing system and additional files.");
    let f = filter(["**/*.{bmp,png,jpg}"], { restore: true });
    return merge(this.systemFiles(config), this.additionalFiles(config))
      .pipe(f)
      .pipe(pngquant())
      .pipe(f.restore);
  }

  ebootFile(config: IVitaProjectConfiguration) {
    this.logger(`Bundling ${config.type} eboot file...`);
    return src(`${config.systemDir}/eboot_${config.type}.bin`).pipe(rename(defaults.ebootFileNames.original));
  }

  projectFiles(config: IVitaProjectConfiguration) {
    this.logger("Assembling project files...");
    return merge(
      this.generatedSfoFile(config),
      this.ebootFile(config),
      this.sourceFiles(config),
      this.processedFiles(config)
    );
  }

  build(config: IVitaProjectConfiguration) {
    this.compileSourceFiles();
    return this.projectFiles(config)
      .pipe(zip(`${config.title}.vpk`))
      .pipe(
        gulp.dest(config.outDir ?? defaults.config.outDir ?? "dist")
      );
  }

  async deployAsync(config: IVitaProjectConfiguration) {
    this.validateIp(config.ip);

    this.compileSourceFiles();
    let tempDir = config.tempDir;
    this.logger("Bundling project files to temp directory.");
    await toPromise(this.projectFiles(config).pipe(gulp.dest(tempDir)));
    this.logger("Files bundled.");
    this.logger("Closing applications just in case.");
    await this.sendCmdAsync(config, "destroy");
    let ftp = new Client();
    this.logger("Connecting to FTP server...");
    await ftp.access({
      host: config.ip ?? "localhost",
      port: config.ports?.ftp ?? defaults.config.ports?.ftp ?? defaults.config.ports.ftp,
    });
    this.logger("Connected to FTP server.");
    this.logger("Listing directories");
    this.logger(await ftp.list());
    this.logger("Going to ux0: directory");
    await ftp.cd("ux0:");
    this.logger("Going to app directory");
    await ftp.cd("app");
    this.logger(`Going to ${config.id} directory`);
    await ftp.cd(config.id);
    this.logger("Uploading files...");
    await ftp.uploadFromDir(tempDir);
    this.logger("Files uploaded.");
    this.logger("Closing connection.");
    ftp.close();
    this.logger("Connection closed");
    this.logger("Clearing temp directory");
    await this.clearTempDirectoryAsync(config);
    this.logger("Cleared temp directory.");
  }
}

gulp.task("default", async () => {
  let project = new VitaProject();
  project.build(project.configuration);
});
gulp.task("build", async () => {
  let project = new VitaProject();
  project.build(project.configuration);
});

gulp.task("test:cmd", async () => {
  let project = new VitaProject();
  project.logger("Launching application...");
  await project.sendCmdAsync(project.configuration, `launch ${project.configuration.id}`);
  project.logger("Application launched.");
  project.logger("Waiting two seconds.");
  await sleepAsync(2000);
  project.logger("Destroying applications...");
  await project.sendCmdAsync(project.configuration, "destroy");
  project.logger("Applications destroyed.");
});

gulp.task("deploy", async () => {
  let project = new VitaProject();
  await project.deployAsync(project.configuration);
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
  let project = new VitaProject();
});
