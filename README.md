# tstlpp-vita
A boilerplate project to create Vita homebrew using [lpp-vita](https://github.com/Rinnegatamante/lpp-vita) and [TypeScript to lua transpiler](https://github.com/TypeScriptToLua/TypeScriptToLua).
Handles the process of creating a param.sfo file, compressing of image files using [pngquant](https://pngquant.org/) and creating a vpk package.

## Install
### Step 1
First, download the latest lpp-vita release from [here](https://github.com/Rinnegatamante/lpp-vita/releases/latest) and locate the "eboot_safe.bin" and "eboot_unsafe.bin" files.

### Step 2
Install node from [here](https://nodejs.org/) if you don't have it.
### Step 3
Install [gulp](https://gulpjs.com/) cli globally. It's used for the build process.
```
npm install -g gulp/cli 
```
### Step 4
Clone this project and run these commands.
```
cd tstlpp-vita
npm install
```
### Step 5
Copy and paste the "eboot_safe.bin" and "eboot_unsafe.bin" files to "system" folder.

### Step 6
Edit the vita-project.json file to your needs. Details are in the "The Vita Project File" section.

That's it.

## Usage
### Development
Run the below command to watch for file changes to auto-transpile TypeScript to lua. The index.lua file will be in the "out-src" folder by default.
```
npm run dev
```
You can use [BGFTP](https://github.com/GrapheneCt/BGFTP) and an FTP client - like WinSCP to auto-sync updated source file.
### Building
Run the below command to create a vpk package that is ready to be used.
```
npm run build
```
The vpk package will be located at the distribution folder.

## Notes
Make sure your image file format is PNG and it's 8-bit and uses the indexed mode. [GIMP](https://www.gimp.org/) has the option to change the bit and image modes.

## The Vita Project File
vita-project.json file is where you can define Vita homebrew specific details to be used in the build process.
#### Title ID (id)
It's a unique identifier for your homebrew. You can enter anything as long as it's 9 characters long and all in UPPERCASE (eg; HELLOWRLD).
There is also a XXXXYYYYY pattern you can use where XXXX part can be author or app specific and YYYYY part can be number of that app. (eg; FTHD00001)
Your choice.
#### Title (title)
This is the name of your homebrew.
#### Unsafe (unsafe)
Defines the eboot file to be used. 
If it's true, "eboot_unsafe.bin" will be used. 
If it's false, "eboot_safe.bin" will be used.
#### System Directory (systemDir) | Optional
Defines the directory where Vita application system files are located. Default value is "system".
#### Source Directory (sourceDir) | Optional
Defines the directory where index.lua file located. Default value is "out-src".
#### Temporary Directory (tempDir) | Optional
Defines the directory where all the files copied before the packaging happens. This folder will be created during the build and deleted after the build process. Default value is ".temp".
#### Distribution Directory (outDir) | Optional
Defines the directory where the packaged vpk file will be located. Default value is "dist".
#### Files (files) | Optional
Defines the files to be bundled within the package.
For example, you can define a single file like below;
```
{
	...
	files:[
		"assets/images/image.jpg"
	],
	...
}
```
Or you can define a globbing pattern. The example below will copy all of the files within the "assets" folder.
```
{
	...
	files:[
		"assets/**/*"
	],
	...
}
```

