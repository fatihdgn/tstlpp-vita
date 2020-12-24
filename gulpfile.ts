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
const pngquant = require("gulp-pngquant");
const intermediate = require("gulp-intermediate");

interface IVitaProjectConfiguration {
  id: string | null;
  title: string | null;
  unsafe: boolean | null;
  systemDir?: string | null;
  sourceDir?: string | null;
  tempDir?: string | null;
  outDir?: string | null;
  files?: Array<string> | null;
}

const defaults = {
  projectConfigurationFilePath: "./vita-project.json",
  ebootFileNames: {
    original: "eboot.bin",
    safe: "eboot_safe.bin",
    unsafe: "eboot_unsafe.bin",
  },
  config: <IVitaProjectConfiguration>{
    id: "HELLOWRLD",
    title: "Hello World",
    unsafe: false,
    systemDir: "system",
    sourceDir: "out-src",
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
};

async function sleepAsync(ms: number) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms));
}

class VitaProject {
  constructor(
    configurationFilePath?: string,
    public logger: (message: string) => void = console.log // Verbose?
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
    let vitaProjectConfig: IVitaProjectConfiguration = JSON.parse(
      fs.readFileSync(filePath, "utf-8")
    );
    vitaProjectConfig = Object.assign(defaults.config, vitaProjectConfig);
    this.logger("Configuration readed successfully.");
    return vitaProjectConfig;
  }

  private validateConfiguration(configuration: IVitaProjectConfiguration) {
    this.logger("Validating configuration...");
    if (configuration.id == null || configuration.id.length !== 9)
      throw errors.idDoesNotConformRequirements;
    if (configuration?.title == null) throw errors.titleIsNotAvailable;
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
}

gulp.task("default", async () => {
  let project = new VitaProject();
  project.build();
});
gulp.task("build", async () => {
  let project = new VitaProject();
  project.build();
});
