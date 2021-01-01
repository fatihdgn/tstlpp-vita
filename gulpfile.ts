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
  unsafe: boolean;
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
  },
  config: <IVitaProjectConfiguration>{
    id: null,
    title: null,
    unsafe: false,
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

const errors = {
  projectConfigFileIsMissing:
    "vita-project.json file is missing. It's required for the build process.",
  idDoesNotConformRequirements:
    "'id' is not defined or does not conform the requirements. It must be exactly 9 characters long.",
  titleIsNotAvailable: "'title' is not available.",
  safeEbootFileIsMissing:
    "Safe eboot file is missing. Make sure you have the eboot_safe.bin and eboot_unsafe.bin files at the system directory. Download them from 'https://github.com/Rinnegatamante/lpp-vita/releases/latest' if you don't have these files...",
  unsafeEbootFileIsMissing:
    "Unsafe eboot file is missing. Make sure you have the eboot_safe.bin and eboot_unsafe.bin files at the system directory. Download them from 'https://github.com/Rinnegatamante/lpp-vita/releases/latest' if you don't have these files...",
  ipIsNotDefined:
    "'ip' is not defined inside project file and not sent from connect call.",
};

// TODO: Find a way to get these Vita Project codes out from the gulpfile.ts

// TODO: Implement a resource file structure to get

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

  private validateConfiguration(configuration: IVitaProjectConfiguration) {
    this.logger("Validating configuration...");
    if (configuration.id == null || configuration.id.length !== 9)
      throw errors.idDoesNotConformRequirements;
    if (configuration.title == null) throw errors.titleIsNotAvailable;

    if(configuration.unsafe == null) throw "Configuration has an error.";
    this.logger("Configuration has no errors.");
  }

  async checkEbootFilesAsync() {
    this.logger("Checking eboot files.");
    if (
      !fs.existsSync(
        `${this.configuration.systemDir}/${defaults.ebootFileNames.safe}`
      )
    )
      throw errors.safeEbootFileIsMissing;
    if (
      !fs.existsSync(
        `${this.configuration.systemDir}/${defaults.ebootFileNames.unsafe}`
      )
    )
      throw errors.unsafeEbootFileIsMissing;
    this.logger("Eboot files are okay.");
  }

  generateNetcatClient(): typeof NetcatClient {
    if (this.configuration.ip == null) throw errors.ipIsNotDefined;
    return new NetcatClient()
      .addr(this.configuration.ip)
      .port(this.configuration.ports?.cmd ?? defaults.config.ports?.cmd ?? 1338)
      .retry(5000);
  }

  sendCmdAsync(cmd: string) {
    return new Promise<void>((resolve, reject) => {
      let nc: typeof NetcatClient;
      try {
        nc = this.generateNetcatClient();
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

  async connectAndSendFileFromFtpAsync() {
    if (this.configuration.ip == null) throw errors.ipIsNotDefined;
    if (this.configuration.id == null) throw "Id is not correct.";
    let ftp = new Client();
    this.logger("Connecting to FTP server...");
    await ftp.access({
      host: this.configuration.ip,
      port: this.configuration.ports?.ftp ?? defaults.config.ports?.ftp ?? 1337,
    });
    this.logger("Connected to FTP server.");
    this.logger("Listing directories");
    this.logger(await ftp.list());
    this.logger("Going to ux0: directory");
    await ftp.cd("ux0:");
    this.logger("Going to app directory");
    await ftp.cd("app");
    this.logger(`Going to ${this.configuration.id} directory`);
    await ftp.cd(this.configuration.id);
    this.logger("Uploading file...");

    await ftp.uploadFrom("./assets/100x100.png", "100x100.png");
    this.logger("File uploaded.");
    this.logger("Closing connection.");
    ftp.close();
    this.logger("Connection closed");
  }

  async clearTempDirectoryAsync() {
    this.logger("Clearing temp directory...");
    if (this.configuration.tempDir) {
      await del(this.configuration.tempDir);
      this.logger("Temp directory cleared.");
    } else throw "FATAL ERROR: Temp directory is not defined...";
  }

  async clearOutDirectoryAsync() {
    this.logger("Clearing out directory...");
    if (this.configuration.outDir) {
      await del(`${this.configuration.outDir}/**/*`);
      this.logger("Out directory cleared.");
    } else throw "FATAL ERROR: Out directory is not defined...";
  }

  compileSourceFiles() {
    this.logger("Compiling source files...");
    execSync("npx tstl");
    this.logger("Compile completed.");
  }

  generateSfoFile(path: string) {
    this.logger(`Generating sfo file to path: ${path}`);
    execSync(
      `vita-mksfoex -s TITLE_ID=${this.configuration.id} "${this.configuration.title}" ${path}`
    );
    this.logger("Sfo file generated.");
  }
  generatedSfoFile() {
    let sfoFilePath = `${os.tmpdir()}/param.sfo`;
    this.generateSfoFile(sfoFilePath);
    return gulp.src(sfoFilePath).pipe(rename("sce_sys/param.sfo"));
  }

  sourceFiles() {
    this.logger("Bundling source files...");
    return src(
      `${
        this.configuration.sourceDir ?? defaults.config.sourceDir ?? "out-src"
      }/**/*`
    );
  }

  additionalFiles() {
    this.logger("Bundling additional files.");
    return src(this.configuration.files ?? []);
  }

  systemFiles() {
    this.logger("Bundling system files.");
    return src([
      `${this.configuration.systemDir}/**/*`,
      `!${this.configuration.systemDir}/${defaults.ebootFileNames.safe}`,
      `!${this.configuration.systemDir}/${defaults.ebootFileNames.unsafe}`,
    ]);
  }

  processedFiles() {
    this.logger("Processing system and additional files.");
    let f = filter(["**/*.{bmp,png,jpg}"], { restore: true });
    return merge(this.systemFiles(), this.additionalFiles())
      .pipe(f)
      .pipe(pngquant())
      .pipe(f.restore);
  }

  ebootFile(unsafe?: boolean) {
    if (unsafe == null)
      unsafe = this.configuration.unsafe ?? defaults.config.unsafe ?? false;
    this.logger(`Bundling ${unsafe ? "unsafe" : "safe"} eboot file...`);
    return src(
      unsafe
        ? `${this.configuration.systemDir}/${defaults.ebootFileNames.unsafe}`
        : `${this.configuration.systemDir}/${defaults.ebootFileNames.safe}`
    ).pipe(rename(defaults.ebootFileNames.original));
  }

  projectFiles() {
    this.logger("Assembling project files...");
    return merge(
      this.generatedSfoFile(),
      this.ebootFile(),
      this.sourceFiles(),
      this.processedFiles()
    );
  }

  build() {
    this.compileSourceFiles();
    return this.projectFiles()
      .pipe(zip(`${this.configuration.title}.vpk`))
      .pipe(
        gulp.dest(this.configuration.outDir ?? defaults.config.outDir ?? "dist")
      );
  }

  async deployAsync() {
    this.compileSourceFiles();
    let tempDir =
      this.configuration.tempDir ?? defaults.config.tempDir ?? ".temp";
    this.logger("Bundling project files to temp directory.");
    await toPromise(this.projectFiles().pipe(gulp.dest(tempDir)));
    this.logger("Files bundled.");
    this.logger("Closing applications just in case.");
    await this.sendCmdAsync("destroy");
    let ftp = new Client();
    this.logger("Connecting to FTP server...");
    await ftp.access({
      host: this.configuration.ip ?? "localhost",
      port: this.configuration.ports?.ftp ?? defaults.config.ports?.ftp ?? 1337,
    });
    this.logger("Connected to FTP server.");
    this.logger("Listing directories");
    this.logger(await ftp.list());
    this.logger("Going to ux0: directory");
    await ftp.cd("ux0:");
    this.logger("Going to app directory");
    await ftp.cd("app");
    this.logger(`Going to ${this.configuration.id} directory`);
    await ftp.cd(this.configuration.id ?? defaults.config.id ?? "HELLOWRLD");
    this.logger("Uploading files...");
    await ftp.uploadFromDir(tempDir);
    this.logger("Files uploaded.");
    this.logger("Closing connection.");
    ftp.close();
    this.logger("Connection closed");
    this.logger("Clearing temp directory");
    await this.clearTempDirectoryAsync();
    this.logger("Cleared temp directory.");
  }
}

gulp.task("default", async () => {
  let project = new VitaProject();
  project.build();
});
gulp.task("build", async () => {
  let project = new VitaProject();
  project.build();
});

gulp.task("test:cmd", async () => {
  let project = new VitaProject();
  project.logger("Launching application...");
  await project.sendCmdAsync(`launch ${project.configuration.id}`);
  project.logger("Application launched.");
  project.logger("Waiting two seconds.");
  await sleepAsync(2000);
  project.logger("Destroying applications...");
  await project.sendCmdAsync("destroy");
  project.logger("Applications destroyed.");
});

gulp.task("deploy", async () => {
  let project = new VitaProject();
  await project.deployAsync();
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
