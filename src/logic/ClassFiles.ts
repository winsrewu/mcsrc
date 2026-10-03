import { distinctUntilChanged, map } from "rxjs";
import { minecraftJar } from "./MinecraftApi";
import { isClassFilePath, type ClassFilePath } from "../utils/Names";

export const fileList = minecraftJar.pipe(
    distinctUntilChanged(),
    map(jar => Object.keys(jar.jar.entries))
);

// File list that only contains outer class files
export const classesList = fileList.pipe(
    map(files => files.filter((file): file is ClassFilePath => isClassFilePath(file) && !file.includes('$')))
);
