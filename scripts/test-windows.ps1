$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$DefaultJavaHome = "C:\Users\Admin\.jdks\ms-21.0.10"
if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\java.exe") -and -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
    $env:JAVA_HOME = Split-Path -Parent $env:JAVA_HOME
}

if ((-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) -and (Test-Path "$DefaultJavaHome\bin\java.exe")) {
    $env:JAVA_HOME = $DefaultJavaHome
}

if ($env:JAVA_HOME) {
    $env:Path = "$env:JAVA_HOME\bin;$env:Path"
}

$DefaultMavenBin = "E:\tools\apache-maven-3.9.14\bin"
if ((Test-Path "$DefaultMavenBin\mvn.cmd") -and ($env:Path -notlike "*$DefaultMavenBin*")) {
    $env:Path = "$DefaultMavenBin;$env:Path"
}

$env:SPRING_PROFILES_ACTIVE = if ($env:SPRING_PROFILES_ACTIVE) { $env:SPRING_PROFILES_ACTIVE } else { "windows-test" }

mvn spring-boot:run
