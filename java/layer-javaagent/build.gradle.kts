import org.gradle.api.GradleException
import java.util.zip.ZipFile

plugins {
    `java-library`
}

val maxLayerZipBytes = 18_874_368L

val javaInstrumentationPath =
    providers.environmentVariable("OPENTELEMETRY_JAVA_INSTRUMENTATION_PATH")
        .orElse(layout.projectDirectory.dir("../../opentelemetry-java-instrumentation").asFile.absolutePath)
        .get()

val lambdaMinimalAgentJar = fileTree("$javaInstrumentationPath/javaagent/build/libs") {
    include("opentelemetry-javaagent-*-lambda-minimal.jar")
}
val resolvedLambdaMinimalAgentJar =
    providers.provider {
        lambdaMinimalAgentJar.files.maxByOrNull { it.lastModified() }
            ?: error("No lambda-minimal Java agent jar found under $javaInstrumentationPath/javaagent/build/libs")
    }

tasks {
    val createLayer by registering(Zip::class) {
        archiveFileName.set("opentelemetry-javaagent-layer.zip")
        destinationDirectory.set(file("$buildDir/distributions"))

        from(resolvedLambdaMinimalAgentJar) {
            rename(".*.jar", "opentelemetry-javaagent.jar")
        }

        from("scripts")
    }

    val checkLayerSize by registering {
        dependsOn(createLayer)

        doLast {
            val layerZip = createLayer.get().archiveFile.get().asFile
            val zipBytes = layerZip.length()
            val remainingBytes = maxLayerZipBytes - zipBytes

            println("Java layer zip: ${layerZip.absolutePath}")
            println("Java layer zip size: ${zipBytes} bytes")
            println("Java layer size limit: ${maxLayerZipBytes} bytes")
            println("Java layer headroom: ${remainingBytes} bytes")

            ZipFile(layerZip).use { zip ->
                zip.entries()
                    .asSequence()
                    .filter { !it.isDirectory }
                    .sortedByDescending { it.compressedSize }
                    .forEach { entry ->
                        println("${entry.compressedSize}\t${entry.size}\t${entry.name}")
                    }
            }

            if (zipBytes > maxLayerZipBytes) {
                throw GradleException("Java layer zip exceeds size limit: ${zipBytes} bytes > ${maxLayerZipBytes} bytes")
            }
        }
    }

    named("assemble") {
        dependsOn(checkLayerSize)
    }
}
