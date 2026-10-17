package health.hale.capture

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.ByteBuffer
import java.nio.ByteOrder

class CaptureJournalTest {
  @get:Rule val directory = TemporaryFolder()

  @Test fun sealedSegmentHasAValidMono16KhzWavHeader() {
    val file = directory.newFile("0-1000.part")
    file.writeBytes(ByteArray(44 + BYTES_PER_SECOND))
    val sealed = CaptureJournal.seal(file)!!
    val data = sealed.readBytes()
    val header = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
    assertEquals("RIFF", String(data, 0, 4))
    assertEquals("WAVE", String(data, 8, 4))
    assertEquals(1, header.getShort(22).toInt())
    assertEquals(16000, header.getInt(24))
    assertEquals(16, header.getShort(34).toInt())
    assertEquals(BYTES_PER_SECOND, header.getInt(40))
    assertEquals("0-1000.wav", sealed.name)
    assertFalse(file.exists())
  }

  @Test fun emptyPartialDoesNotBecomeAnUpload() {
    val file = directory.newFile("1-2000.part")
    file.writeBytes(ByteArray(44))
    assertNull(CaptureJournal.seal(file))
    assertFalse(file.exists())
  }

  @Test fun interruptedOddByteSampleIsTruncatedToACompletePcmFrame() {
    val file = directory.newFile("2-3000.part")
    file.writeBytes(ByteArray(49))
    val sealed = CaptureJournal.seal(file)!!
    assertEquals(48L, sealed.length())
    assertEquals(4, ByteBuffer.wrap(sealed.readBytes()).order(ByteOrder.LITTLE_ENDIAN).getInt(40))
  }
}
