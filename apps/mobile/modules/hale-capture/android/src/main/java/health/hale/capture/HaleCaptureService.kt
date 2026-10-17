package health.hale.capture

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.annotation.RequiresPermission
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class HaleCaptureService : Service() {
  private var recorder: AudioRecord? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var focus: AudioFocusRequest? = null
  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change < 0) {
      CaptureJournal.message = "Audio was interrupted by another app or call. Recording stopped; switch it on again when ready."
      CaptureJournal.stopRequested = true
    }
  }

  companion object {
    private const val CHANNEL = "hale-live-capture"
    private const val NOTIFICATION_ID = 7201
    private val uploader = Executors.newSingleThreadScheduledExecutor()
    private val retryStarted = AtomicBoolean(false)

    fun retry(context: Context) {
      val app = context.applicationContext
      if (retryStarted.compareAndSet(false, true)) {
        uploader.scheduleWithFixedDelay({ uploadNext(app) }, 0, 2, TimeUnit.SECONDS)
      } else {
        uploader.execute { uploadNext(app) }
      }
    }

    private fun connection(url: String, token: String): HttpURLConnection {
      check(URL(url).protocol == "https") { "Secure upload required." }
      return (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        setRequestProperty("Authorization", "Bearer $token")
        connectTimeout = 15000
        readTimeout = 30000
        instanceFollowRedirects = false
        doOutput = true
      }
    }

    private fun uploadNext(context: Context) {
      val claim = try { CaptureJournal.claimUpload(context) } catch (_: Exception) {
        CaptureJournal.message = "Saved audio metadata could not be read. Do not clear app data; contact support."
        null
      } ?: return
      try {
        val (session, file) = claim
        val base = session.getString("siteUrl").trimEnd('/')
        val token = CaptureAuthentication.tokenFor(session.getString("owner"))
        if (token == null) {
          CaptureJournal.message = "Sign in needs refreshing. Open Hale to reconnect; unsent audio stays on this device."
          return
        }
        if (file != null) {
          val sequence = file.name.substringBefore('-').toInt()
          val capturedAt = file.nameWithoutExtension.substringAfter('-').toLong()
          val endedAt = capturedAt + (file.length() - 44) * 1000 / BYTES_PER_SECOND
          val url = "$base/audio?sessionId=${session.getString("sessionId")}&sequence=$sequence&capturedAt=$capturedAt&endedAt=$endedAt"
          val request = connection(url, token)
          try {
            request.setRequestProperty("Content-Type", "audio/wav")
            request.setFixedLengthStreamingMode(file.length())
            request.outputStream.use { output -> file.inputStream().use { it.copyTo(output) } }
            if (!accepted(request.responseCode)) return
            val result = JSONObject(request.inputStream.bufferedReader().use { it.readText() })
            check(result.has("chunkId"))
            check(file.delete())
            if (CaptureJournal.message.startsWith("Waiting for") || CaptureJournal.message.startsWith("Upload is delayed") || CaptureJournal.message.startsWith("Sign in")) CaptureJournal.message = ""
          } finally { request.disconnect() }
        } else {
          val request = connection("$base/recording-stop", token)
          try {
            request.setRequestProperty("Content-Type", "application/json")
            request.outputStream.use { it.write(JSONObject().put("sessionId", session.getString("sessionId")).toString().toByteArray()) }
            if (!accepted(request.responseCode)) return
            CaptureJournal.update(context) { it.put("serverStopped", true) }
          } finally { request.disconnect() }
        }
      } catch (_: Exception) {
        CaptureJournal.message = "Waiting for a connection. Audio is saved privately on this device and will retry."
      } finally { CaptureJournal.uploading = false }
    }

    private fun accepted(status: Int): Boolean {
      if (status in 200..299) return true
      if (status == 401) {
        CaptureJournal.token = ""
        CaptureJournal.message = "Sign in needs refreshing. Open Hale to reconnect; unsent audio stays on this device."
      } else if (status == 400 || status == 403 || status == 404) {
        CaptureJournal.uploadBlocked = true
        CaptureJournal.stopRequested = true
        CaptureJournal.token = ""
        CaptureJournal.message = "Upload access changed. Recording stopped. Review your session or discard unsent audio."
      } else {
        CaptureJournal.message = "Upload is delayed. Retrying automatically; the transcript may be behind."
      }
      return false
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "STOP") {
      CaptureJournal.stopRequested = true
      return START_NOT_STICKY
    }
    if (intent?.action != "START" || CaptureJournal.capturing) return START_NOT_STICKY
    try {
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "Live conversation recording", NotificationManager.IMPORTANCE_LOW))
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hale:live-capture").apply { acquire() }
      CaptureJournal.capturing = true
      Thread({ capture() }, "hale-microphone").start()
      retry(this)
    } catch (_: Exception) {
      CaptureJournal.starting = false
      CaptureJournal.capturing = false
      CaptureJournal.finish(this)
      CaptureJournal.message = "The microphone could not start. Check microphone and notification permissions."
      stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun notification(): Notification {
    val stop = PendingIntent.getService(this, 0, Intent(this, HaleCaptureService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 1, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle("Hale · recording is on")
      .setContentText("Conversations are being transcribed. Tap Stop at any time.")
      .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
      .addAction(android.R.drawable.ic_media_pause, "Stop recording", stop).build()
  }

  @RequiresPermission(Manifest.permission.RECORD_AUDIO)
  private fun capture() {
    var partial: File? = null
    var output: FileOutputStream? = null
    try {
      val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
      val granted = if (Build.VERSION.SDK_INT >= 26) {
        focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener(focusListener, android.os.Handler(mainLooper)).build()
        audioManager.requestAudioFocus(focus!!)
      } else {
        @Suppress("DEPRECATION")
        audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
      }
      check(granted == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
      val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minimum > 0)
      val audio = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum * 2, 6400))
      recorder = audio
      check(audio.state == AudioRecord.STATE_INITIALIZED)
      if (Build.VERSION.SDK_INT >= 29) audio.registerAudioRecordingCallback(mainExecutor, object : AudioManager.AudioRecordingCallback() {
        override fun onRecordingConfigChanged(configs: MutableList<android.media.AudioRecordingConfiguration>) {
          if (configs.any { it.clientAudioSessionId == audio.audioSessionId && it.isClientSilenced }) {
            CaptureJournal.message = "Android silenced the microphone. Recording stopped; check other apps and microphone access."
            CaptureJournal.stopRequested = true
          }
        }
      })
      audio.startRecording()
      check(audio.recordingState == AudioRecord.RECORDSTATE_RECORDING)
      CaptureJournal.starting = false
      val buffer = ByteArray(3200)
      var segmentBytes = 0
      while (!CaptureJournal.stopRequested) {
        if (partial == null) {
          if (CaptureJournal.queue(this).size >= MAX_QUEUED_SEGMENTS) {
            CaptureJournal.message = "Recording stopped because the five-minute offline queue is full. Reconnect and upload before starting again."
            break
          }
          val sequence = CaptureJournal.read(this)!!.getInt("nextSequence")
          CaptureJournal.update(this) { it.put("nextSequence", sequence + 1) }
          partial = CaptureJournal.openSegment(this, sequence, System.currentTimeMillis())
          output = FileOutputStream(partial, true)
          segmentBytes = 0
        }
        val count = audio.read(buffer, 0, buffer.size)
        check(count > 0) { "Microphone stopped delivering audio." }
        output!!.write(buffer, 0, count)
        segmentBytes += count
        if (segmentBytes >= SEGMENT_SECONDS * BYTES_PER_SECOND) {
          output.close(); output = null
          CaptureJournal.completeSegment(this, partial); partial = null
        }
      }
    } catch (_: Exception) {
      if (CaptureJournal.message.isEmpty()) CaptureJournal.message = "Recording was interrupted. Saved audio will retry; switch recording on again when ready."
    } finally {
      try { recorder?.stop() } catch (_: Exception) { }
      recorder?.release(); recorder = null
      try { output?.close(); partial?.let { CaptureJournal.completeSegment(this, it) } } catch (_: Exception) {
        CaptureJournal.message = "Audio storage failed. Recording stopped. Check available device storage."
      }
      CaptureJournal.starting = false
      CaptureJournal.capturing = false
      CaptureJournal.finish(this)
      retry(this)
      stopSelf()
    }
  }

  override fun onDestroy() {
    CaptureJournal.stopRequested = true
    val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= 26) focus?.let { audioManager.abandonAudioFocusRequest(it) }
    else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(focusListener)
    }
    if (wakeLock?.isHeld == true) wakeLock?.release()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
