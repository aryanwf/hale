package health.hale.capture

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class HaleCaptureModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("HaleCapture")

    AsyncFunction("start") { options: String ->
      CaptureJournal.begin(context, JSONObject(options))
      try {
        ContextCompat.startForegroundService(context, Intent(context, HaleCaptureService::class.java).setAction("START"))
      } catch (error: Exception) {
        CaptureJournal.starting = false
        CaptureJournal.finish(context)
        throw error
      }
    }
    AsyncFunction("stop") { owner: String, patientId: String ->
      check(CaptureJournal.owns(context, owner, patientId)) { "Wrong recording space." }
      CaptureJournal.stopRequested = true
      val deadline = android.os.SystemClock.elapsedRealtime() + 5000
      while ((CaptureJournal.capturing || CaptureJournal.starting) && android.os.SystemClock.elapsedRealtime() < deadline) android.os.SystemClock.sleep(50)
      check(!CaptureJournal.capturing && !CaptureJournal.starting) { "The microphone is still stopping. Try again." }
    }
    AsyncFunction("status") { owner: String, patientId: String -> CaptureJournal.status(context, owner, patientId) }
    AsyncFunction("credentials") { owner: String, patientId: String, token: String ->
      check(CaptureJournal.owns(context, owner, patientId)) { "Wrong recording space." }
      CaptureJournal.recover(context)
      CaptureJournal.token = token
      if (token.isNotEmpty()) {
        if (CaptureJournal.message.startsWith("Sign in")) CaptureJournal.message = ""
        HaleCaptureService.retry(context)
      } else {
        CaptureJournal.stopRequested = true
      }
    }
    AsyncFunction("discard") { owner: String, patientId: String -> CaptureJournal.discard(context, owner, patientId) }
    AsyncFunction("retryUploads") { owner: String, patientId: String ->
      check(CaptureJournal.owns(context, owner, patientId)) { "Wrong recording space." }
      CaptureJournal.uploadBlocked = false
      HaleCaptureService.retry(context)
    }
  }
}
