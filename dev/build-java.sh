#!/bin/bash
# This script builds the OpenTelemetry Java layers.
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)
JAVA_INSTRUMENTATION_PATH="${OPENTELEMETRY_JAVA_INSTRUMENTATION_PATH:-$ROOT_DIR/../opentelemetry-java-instrumentation}"
LAYER_ZIP="$ROOT_DIR/java/layer-javaagent/build/distributions/opentelemetry-javaagent-layer.zip"

if command -v rg >/dev/null 2>&1; then
    SEARCH_BIN=(rg -n -a -S)
else
    SEARCH_BIN=(grep -RInaE)
fi

SOURCE_PATTERNS=(
    '(?i)MessageDigest\.getInstance\("?(md4|md5|sha1|sha-1|ripemd|ripemd160)"?\)'
    '(?i)Mac\.getInstance\("?(md4|md5|sha1|sha-1|ripemd|ripemd160)"?\)'
    '(?i)Cipher\.getInstance\("?(des|desede|des/|rc2|rc4|blowfish|idea)'
    '(?i)SecureRandom\.getInstance\("?(sha1prng)"?\)'
)

apply_java_fips_patch() {
    local target_file="$JAVA_INSTRUMENTATION_PATH/instrumentation/runtime-telemetry/javaagent/src/main/java/io/opentelemetry/javaagent/instrumentation/runtimetelemetry/JarAnalyzer.java"

    if [ ! -d "$JAVA_INSTRUMENTATION_PATH" ]; then
        echo "Java instrumentation repo not found: $JAVA_INSTRUMENTATION_PATH" >&2
        exit 1
    fi

    if rg -q 'SHA-256' "$target_file"; then
        echo "Java FIPS patch already present"
        return 0
    fi

    git -C "$JAVA_INSTRUMENTATION_PATH" apply <<'PATCH'
diff --git a/instrumentation/runtime-telemetry/javaagent/src/main/java/io/opentelemetry/javaagent/instrumentation/runtimetelemetry/JarAnalyzer.java b/instrumentation/runtime-telemetry/javaagent/src/main/java/io/opentelemetry/javaagent/instrumentation/runtimetelemetry/JarAnalyzer.java
index 2de5944172..228ecc2d37 100644
--- a/instrumentation/runtime-telemetry/javaagent/src/main/java/io/opentelemetry/javaagent/instrumentation/runtimetelemetry/JarAnalyzer.java
+++ b/instrumentation/runtime-telemetry/javaagent/src/main/java/io/opentelemetry/javaagent/instrumentation/runtimetelemetry/JarAnalyzer.java
@@ -220,9 +220,9 @@ final class JarAnalyzer implements ClassFileTransformer {
     builder.put(PACKAGE_VERSION, jarDetails.version());
     builder.put(PACKAGE_DESCRIPTION, jarDetails.packageDescription());
 
-    String packageChecksum = jarDetails.computeSha1();
+    String packageChecksum = jarDetails.computeSha256();
     builder.put(PACKAGE_CHECKSUM, packageChecksum);
-    builder.put(PACKAGE_CHECKSUM_ALGORITHM, "SHA1");
+    builder.put(PACKAGE_CHECKSUM_ALGORITHM, "SHA-256");
 
     logger
         .logRecordBuilder()
diff --git a/instrumentation/runtime-telemetry/javaagent/src/main/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarDetails.java b/instrumentation/runtime-telemetry/javaagent/src/main/java/io/opentelemetry/javaagent/instrumentation/runtimetelemetry/JarDetails.java
index 20532a406c..7b9807dfcb 100644
--- a/instrumentation/runtime-telemetry/javaagent/src/main/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarDetails.java
+++ b/instrumentation/runtime-telemetry/javaagent/src/main/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarDetails.java
@@ -43,11 +43,11 @@ class JarDetails {
               collectingAndThen(
                   toMap(ext -> ('.' + ext + "!/"), identity()),
                   Collections::<String, String>unmodifiableMap));
-  private static final ThreadLocal<MessageDigest> sha1 =
+  private static final ThreadLocal<MessageDigest> sha256 =
       ThreadLocal.withInitial(
           () -> {
             try {
-              return MessageDigest.getInstance("SHA1");
+              return MessageDigest.getInstance("SHA-256");
             } catch (NoSuchAlgorithmException e) {
               throw new IllegalStateException(e);
             }
@@ -56,14 +56,14 @@ class JarDetails {
   private final URL url;
   @Nullable private final Properties pom;
   @Nullable private final Manifest manifest;
-  private final String sha1Checksum;
+  private final String sha256Checksum;
 
   private JarDetails(
-      URL url, @Nullable Properties pom, @Nullable Manifest manifest, String sha1Checksum) {
+      URL url, @Nullable Properties pom, @Nullable Manifest manifest, String sha256Checksum) {
     this.url = url;
     this.pom = pom;
     this.manifest = manifest;
-    this.sha1Checksum = sha1Checksum;
+    this.sha256Checksum = sha256Checksum;
   }
 
   static JarDetails forUrl(URL url) throws IOException {
@@ -88,14 +88,14 @@ class JarDetails {
                 url,
                 getPom(jarFile, jarEntry),
                 getManifest(jarFile, jarEntry),
-                computeDigest(jarFile, jarEntry, sha1.get()));
+                computeDigest(jarFile, jarEntry, sha256.get()));
           }
         }
       }
     }
     try (JarFile jarFile = new JarFile(UrlPaths.toFile(url))) {
       return new JarDetails(
-          url, getPom(jarFile), getManifest(jarFile), computeDigest(url, sha1.get()));
+          url, getPom(jarFile), getManifest(jarFile), computeDigest(url, sha256.get()));
     }
   }
@@ -185,9 +185,9 @@ class JarDetails {
     return name + " by " + vendor;
   }
 
-  /** Returns the SHA1 hash of this file, e.g. {@code 30d16ec2aef6d8094c5e2dce1d95034ca8b6cb42}. */
-  String computeSha1() {
-    return sha1Checksum;
+  /** Returns the SHA-256 hash of this file. */
+  String computeSha256() {
+    return sha256Checksum;
   }
 
   private static String computeDigest(URL url, MessageDigest md) throws IOException {
@@ -210,7 +210,7 @@ class JarDetails {
     byte[] buffer = new byte[8192];
     while (dis.read(buffer) != -1) {}
     byte[] digest = md.digest();
-    return String.format(Locale.ROOT, "%040x", new BigInteger(1, digest));
+    return String.format(Locale.ROOT, "%064x", new BigInteger(1, digest));
   }
 
   @Nullable
diff --git a/instrumentation/runtime-telemetry/javaagent/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarAnalyzerInstallerTest.java b/instrumentation/runtime-telemetry/javaagent/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarAnalyzerInstallerTest.java
index 28c673f4da..248a0cbb4d 100644
--- a/instrumentation/runtime-telemetry/javaagent/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarAnalyzerInstallerTest.java
+++ b/instrumentation/runtime-telemetry/javaagent/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarAnalyzerInstallerTest.java
@@ -46,10 +46,10 @@ class JarAnalyzerInstallerTest {
             logRecord ->
                 assertThat(logRecord.getAttributes())
                     .containsEntry("package.type", "jar")
-                    .containsEntry("package.checksum_algorithm", "SHA1")
+                    .containsEntry("package.checksum_algorithm", "SHA-256")
                     .hasEntrySatisfying(
                         stringKey("package.checksum"),
-                        value -> assertThat(value).matches("[0-9a-f]{40}"))
+                        value -> assertThat(value).matches("[0-9a-f]{64}"))
                     .hasEntrySatisfying(
                         stringKey("package.path"), value -> assertThat(value).isNotNull())
                     .satisfies(
diff --git a/instrumentation/runtime-telemetry/testing/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarAnalyzerTest.java b/instrumentation/runtime-telemetry/testing/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarAnalyzerTest.java
index 75ca185f69..dbfac911c4 100644
--- a/instrumentation/runtime-telemetry/testing/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarAnalyzerTest.java
+++ b/instrumentation/runtime-telemetry/testing/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarAnalyzerTest.java
@@ -71,9 +71,9 @@ class JarAnalyzerTest {
                                     .matches(
                                         "opentelemetry-javaagent-runtime-telemetry-[0-9a-zA-Z-\\.]+\\.jar"))
                         .containsEntry(PACKAGE_DESCRIPTION, "javaagent by OpenTelemetry")
-                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA1")
+                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA-256")
                         .hasEntrySatisfying(
-                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).isNotEmpty()))),
+                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).matches("[0-9a-f]{64}")))),
         // dummy war
         Arguments.of(
             archiveUrl(new File(System.getenv("DUMMY_APP_WAR"))),
@@ -83,9 +83,9 @@ class JarAnalyzerTest {
                         .containsEntry(PACKAGE_TYPE, "war")
                         .containsEntry(PACKAGE_PATH, "app.war")
                         .containsEntry(PACKAGE_DESCRIPTION, "Dummy App by OpenTelemetry")
-                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA1")
+                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA-256")
                         .hasEntrySatisfying(
-                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).isNotEmpty()))),
+                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).matches("[0-9a-f]{64}")))),
         // io.opentelemetry:opentelemetry-api
         Arguments.of(
             archiveUrl(Tracer.class),
@@ -99,9 +99,9 @@ class JarAnalyzerTest {
                                 assertThat(path)
                                     .matches("opentelemetry-api-[0-9a-zA-Z-\\.]+\\.jar"))
                         .containsEntry(PACKAGE_DESCRIPTION, "all")
-                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA1")
+                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA-256")
                         .hasEntrySatisfying(
-                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).isNotEmpty()))),
+                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).matches("[0-9a-f]{64}")))),
         // org.springframework:spring-webmvc
         Arguments.of(
             archiveUrl(HttpRequest.class),
@@ -115,9 +115,9 @@ class JarAnalyzerTest {
                             PACKAGE_PATH,
                             path -> assertThat(path).matches("spring-web-[0-9a-zA-Z-\\.]+\\.jar"))
                         .containsEntry(PACKAGE_DESCRIPTION, "org.springframework.web")
-                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA1")
+                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA-256")
                         .hasEntrySatisfying(
-                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).isNotEmpty()))),
+                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).matches("[0-9a-f]{64}")))),
         // com.google.guava:guava
         Arguments.of(
             archiveUrl(ImmutableMap.class),
@@ -131,9 +131,9 @@ class JarAnalyzerTest {
                         .containsEntry(PACKAGE_NAME, "com.google.guava:guava")
                         .hasEntrySatisfying(
                             PACKAGE_VERSION, version -> assertThat(version).isNotEmpty())
-                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA1")
+                        .containsEntry(PACKAGE_CHECKSUM_ALGORITHM, "SHA-256")
                         .hasEntrySatisfying(
-                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).isNotEmpty()))));
+                            PACKAGE_CHECKSUM, checksum -> assertThat(checksum).matches("[0-9a-f]{64}")))));
   }
 
   private static URL archiveUrl(File file) {
diff --git a/instrumentation/runtime-telemetry/testing/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarDetailsTest.java b/instrumentation/runtime-telemetry/testing/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarDetailsTest.java
index 4a0cd695c6..332879e085 100644
--- a/instrumentation/runtime-telemetry/testing/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarDetailsTest.java
+++ b/instrumentation/runtime-telemetry/testing/src/test/java/io/opentelemetry/javaagent/instrumentation/runtimotelemetry/JarDetailsTest.java
@@ -33,7 +33,7 @@ class JarDetailsTest {
     JarDetails details = JarDetails.forUrl(url);
 
     assertThat(details.packageDescription()).isEqualTo("Test Title by Test Vendor");
-    assertThat(details.computeSha1()).isNotEmpty();
+    assertThat(details.computeSha256()).matches("[0-9a-f]{64}");
   }
 
   @Test
@@ -59,7 +59,7 @@ class JarDetailsTest {
     JarDetails details = JarDetails.forUrl(url);
 
     assertThat(details.packageDescription()).isEqualTo("Inner Title by Inner Vendor");
-    assertThat(details.computeSha1()).isNotEmpty();
+    assertThat(details.computeSha256()).matches("[0-9a-f]{64}");
   }
 
   @Test
@@ -86,7 +86,7 @@ class JarDetailsTest {
     JarDetails details = JarDetails.forUrl(url);
 
     assertThat(details.packageDescription()).isEqualTo("Inner Title by Inner Vendor");
-    assertThat(details.computeSha1()).isNotEmpty();
+    assertThat(details.computeSha256()).matches("[0-9a-f]{64}");
   }
 
   private static Manifest manifest(String title, String vendor) {
PATCH

    echo "Applied Java FIPS patch"
}

scan_targets() {
    local label="$1"
    shift
    local -a targets=("$@")
    local -a args=()
    local pattern

    if [ "${#targets[@]}" -eq 0 ]; then
        return 0
    fi

    if [ "${SEARCH_BIN[0]}" = "rg" ]; then
        args=(
            --glob '!**/test/**'
            --glob '!**/tests/**'
            --glob '!**/__tests__/**'
            --glob '!**/src/test/**'
            --glob '!**/build/**'
            --glob '!**/.gradle/**'
            --glob '!**/docs/**'
            --glob '!**/*.md'
        )

        for pattern in "${SOURCE_PATTERNS[@]}"; do
            args+=(-e "$pattern")
        done

        if "${SEARCH_BIN[@]}" "${args[@]}" "${targets[@]}"; then
            echo "Java FIPS compatibility check failed in ${label}" >&2
            return 1
        fi

        return 0
    fi

    for pattern in "${SOURCE_PATTERNS[@]}"; do
        if "${SEARCH_BIN[@]}" "$pattern" "${targets[@]}"; then
            echo "Java FIPS compatibility check failed in ${label}" >&2
            return 1
        fi
    done
}

check_java_fips_compat() {
    local tmp_dir
    local previous_trap

    echo "Running Java FIPS compatibility check"

    if [ -d "$JAVA_INSTRUMENTATION_PATH" ]; then
        scan_targets \
            "java instrumentation sources" \
            "$JAVA_INSTRUMENTATION_PATH/javaagent" \
            "$JAVA_INSTRUMENTATION_PATH/javaagent-bootstrap" \
            "$JAVA_INSTRUMENTATION_PATH/javaagent-tooling" \
            "$JAVA_INSTRUMENTATION_PATH/muzzle" \
            "$JAVA_INSTRUMENTATION_PATH/instrumentation/runtime-telemetry"
    fi

    if [ ! -f "$LAYER_ZIP" ]; then
        echo "Layer zip not found: $LAYER_ZIP" >&2
        exit 1
    fi

    tmp_dir=$(mktemp -d)
    previous_trap=$(trap -p EXIT || true)
    trap "rm -rf '$tmp_dir'" EXIT

    unzip -q "$LAYER_ZIP" -d "$tmp_dir"
    scan_targets "packaged java layer" "$tmp_dir"
    rm -rf "$tmp_dir"

    if [ -n "$previous_trap" ]; then
        eval "$previous_trap"
    else
        trap - EXIT
    fi

    echo "Java FIPS compatibility check passed"
}

if [ ! -d "$JAVA_INSTRUMENTATION_PATH" ]; then
    git clone git@github.com:coralogix/opentelemetry-java-instrumentation.git "$JAVA_INSTRUMENTATION_PATH" -b coralogix-autoinstrumentation -b coralogix-autoinstrumentation
fi

echo "Publishing OpenTelemetry Java instrumentation to Maven local"
apply_java_fips_patch
pushd "$JAVA_INSTRUMENTATION_PATH"
./gradlew publishToMavenLocal
popd

echo "Building Java agent layer"
pushd "$ROOT_DIR/java"
./gradlew :layer-javaagent:assemble
popd

check_java_fips_compat
