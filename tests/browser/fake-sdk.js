(() => {
  const fixture = window.__FIXTURE__;
  class PushStream { write() {} close() { this.onclose?.(); } }
  class SpeechRecognizer {
    constructor(_config, audio) { this.stream = audio.stream; }
    startContinuousRecognitionAsync(ok) {
      setTimeout(ok, 50);
      setTimeout(() => this.recognizing?.(this, { result: { text: "every morning i walk to the" } }), 400);
      this.stream.onclose = () => setTimeout(() => {
        for (const seg of fixture.segments) {
          this.recognized?.(this, { result: { reason: 3, text: seg.DisplayText, properties: { getProperty: () => JSON.stringify(seg) } } });
        }
        this.canceled?.(this, { reason: 2, errorCode: 0 });
        this.sessionStopped?.(this, {});
      }, 100);
    }
    stopContinuousRecognitionAsync(ok) { ok(); }
    close() {}
  }
  window.SpeechSDK = {
    SpeechConfig: { fromAuthorizationToken: () => ({ setProperty() {}, speechRecognitionLanguage: "" }) },
    PropertyId: { WebWorkerLoadType: 1, SpeechServiceResponse_JsonResult: 2 },
    AudioStreamFormat: { getWaveFormatPCM: () => ({}) },
    AudioInputStream: { createPushStream: () => new PushStream() },
    AudioConfig: { fromStreamInput: (stream) => ({ stream }) },
    PronunciationAssessmentGradingSystem: { HundredMark: 1 },
    PronunciationAssessmentGranularity: { Phoneme: 1 },
    PronunciationAssessmentConfig: class { applyTo() {} },
    ResultReason: { RecognizedSpeech: 3 },
    CancellationReason: { Error: 1, EndOfStream: 2 },
    CancellationErrorCode: { 0: "NoError", 4: "ConnectionFailure" },
    SpeechRecognizer,
  };
})();
