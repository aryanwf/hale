package health.hale.capture

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

internal const val SAMPLE_RATE = 16000
internal const val BYTES_PER_SECOND = SAMPLE_RATE * 2
internal const val SEGMENT_SECONDS = 10
internal const val MAX_QUEUED_SEGMENTS = 30

internal object CaptureJournal {
  @Volatile var capturing = false
  @Volatile var starting = false
  @Volatile var stopRequested = false
  @Volatile var uploading = false
  @Volatile var uploadBlocked = false
  @Volatile var token = ""
  @Volatile var message = ""
  private var state: JSONObject? = null

  fun directory(context: Context) = File(context.filesDir, "hale-live").apply { mkdirs() }
  private fun manifest(context: Context) = AtomicFile(File(directory(context), "session.json"))

  @Synchronized fun read(context: Context): JSONObject? {
    if (state == null && (manifest(context).baseFile.exists() || File(directory(context), "session.json.bak").exists())) {
      state = JSONObject(manifest(context).openRead().bufferedReader().use { it.readText() })
    }
    return state?.let { JSONObject(it.toString()) }
  }

  @Synchronized fun update(context: Context, change: (JSONObject) -> Unit) {
    val current = read(context) ?: return
    change(current)
    persist(context, current)
  }

  @Synchronized private fun persist(context: Context, value: JSONObject) {
    val file = manifest(context)
    val stream = file.startWrite()
    try {
      stream.write(value.toString().toByteArray(Charsets.UTF_8))
      file.finishWrite(stream)
      state = value
    } catch (error: Exception) {
      file.failWrite(stream)
      throw error
    }
  }

  @Synchronized fun begin(context: Context, options: JSONObject) {
    recover(context)
    check(!capturing && !starting && !uploading) { "Recording or an upload is already in progress." }
    check(queue(context).isEmpty() && (read(context)?.optBoolean("serverStopped", true) != false)) {
      "Finish uploading or discard the previous session before recording again."
    }
    check(options.getString("siteUrl").startsWith("https://")) { "A secure upload URL is required." }
    token = options.getString("token")
    options.remove("token")
    options.put("startedAt", System.currentTimeMillis()).put("nextSequence", 0).put("serverStopped", false)
    persist(context, options)
    message = ""
    stopRequested = false
    uploadBlocked = false
    starting = true
  }

  fun queue(context: Context): List<File> = directory(context).listFiles { file -> file.extension == "wav" }
    ?.sortedBy { it.name.substringBefore('-').toIntOrNull() ?: Int.MAX_VALUE } ?: emptyList()

  @Synchronized fun claimUpload(context: Context): Pair<JSONObject, File?>? {
    if (uploading || uploadBlocked) return null
    val current = read(context) ?: return null
    val file = queue(context).firstOrNull()
    if (file == null && (capturing || starting || current.optBoolean("serverStopped"))) return null
    uploading = true
    return Pair(current, file)
  }

  fun openSegment(context: Context, sequence: Int, capturedAt: Long): File {
    val file = File(directory(context), "$sequence-$capturedAt.part")
    file.outputStream().use { it.write(ByteArray(44)) }
    return file
  }

  fun seal(file: File): File? {
    val bytes = ((file.length() - 44).coerceAtLeast(0) / 2 * 2).toInt()
    if (bytes == 0) { check(file.delete()); return null }
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      .put("RIFF".toByteArray()).putInt(bytes + 36).put("WAVEfmt ".toByteArray())
      .putInt(16).putShort(1).putShort(1).putInt(SAMPLE_RATE).putInt(BYTES_PER_SECOND)
      .putShort(2).putShort(16).put("data".toByteArray()).putInt(bytes).array()
    RandomAccessFile(file, "rw").use { it.setLength(bytes + 44L); it.seek(0); it.write(header); it.fd.sync() }
    return File(file.parentFile, "${file.nameWithoutExtension}.wav").also { check(file.renameTo(it)) }
  }

  fun completeSegment(context: Context, file: File) {
    val sealed = seal(file) ?: return
    val capturedAt = sealed.nameWithoutExtension.substringAfter('-').toLong()
    val endedAt = capturedAt + (sealed.length() - 44) * 1000 / BYTES_PER_SECOND
    update(context) { it.put("lastAudioAt", maxOf(it.optLong("lastAudioAt"), endedAt)) }
  }

  @Synchronized fun recover(context: Context) {
    if (capturing || starting) return
    val current = read(context) ?: return
    directory(context).listFiles { file -> file.extension == "part" }?.forEach { completeSegment(context, it) }
    if (!current.has("endedAt")) {
      update(context) { it.put("endedAt", it.optLong("lastAudioAt", it.getLong("startedAt"))) }
      message = "Recording was interrupted. Saved segments will upload when you reconnect; the microphone is off."
    }
  }

  @Synchronized fun finish(context: Context) {
    update(context) { if (!it.has("endedAt")) it.put("endedAt", it.optLong("lastAudioAt", it.getLong("startedAt"))) }
  }

  @Synchronized fun owns(context: Context, owner: String, patientId: String): Boolean {
    val current = read(context) ?: return true
    return current.optString("owner") == owner && current.optString("patientId") == patientId
  }

  @Synchronized fun status(context: Context, owner: String, patientId: String): String {
    recover(context)
    val current = read(context)
    val owns = owns(context, owner, patientId)
    val pending = queue(context).size
    val blocked = !owns && (capturing || starting || pending > 0 || current?.optBoolean("serverStopped", true) == false)
    val result = JSONObject().put("recording", owns && capturing).put("starting", owns && starting)
      .put("uploading", owns && uploading).put("pendingCount", if (owns) pending else 0)
      .put("blockedByAnotherSpace", blocked).put("message", if (owns) message else if (blocked) "A previous account or patient space has unfinished audio. Return to that space to finish or discard it." else "")
    if (owns && current != null) {
      result.put("sessionId", current.optString("sessionId"))
      result.put("seconds", ((if (capturing) System.currentTimeMillis() else current.optLong("endedAt", System.currentTimeMillis())) - current.getLong("startedAt")) / 1000.0)
      result.put("needsFinalization", !current.optBoolean("serverStopped", false))
    }
    return result.toString()
  }

  @Synchronized fun discard(context: Context, owner: String, patientId: String) {
    check(owns(context, owner, patientId) && !capturing && !starting && !uploading) { "Stop recording and wait for uploads before discarding." }
    queue(context).forEach { check(it.delete()) }
    directory(context).listFiles { file -> file.extension == "part" }?.forEach { check(it.delete()) }
    update(context) { it.put("serverStopped", true) }
    message = "Unsent audio discarded. Previously saved dialogue is unchanged."
  }
}
