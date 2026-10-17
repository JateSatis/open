import AVFoundation
import ExpoModulesCore

/// Громкость медиа и куда идёт звук — для журнала рекомендаций. Только чтение.
/// Положение переключателя «без звука» iOS не отдаёт: `muted` — нулевая громкость.
public class AudioOutputModule: Module {
  private var volumeObservation: NSKeyValueObservation?
  private var routeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AudioOutput")

    Events("onChange")

    Function("getState") {
      return self.state()
    }

    OnStartObserving {
      let session = AVAudioSession.sharedInstance()

      self.volumeObservation = session.observe(\.outputVolume, options: [.new]) { [weak self] _, _ in
        self?.emit()
      }
      self.routeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.emit()
      }
    }

    OnStopObserving {
      self.volumeObservation?.invalidate()
      self.volumeObservation = nil

      if let observer = self.routeObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      self.routeObserver = nil
    }
  }

  private func emit() {
    sendEvent("onChange", state())
  }

  private func state() -> [String: Any] {
    let session = AVAudioSession.sharedInstance()
    let volume = Double(session.outputVolume)

    return ["volume": volume, "muted": volume == 0, "route": route(session)]
  }

  private func route(_ session: AVAudioSession) -> String {
    for output in session.currentRoute.outputs {
      switch output.portType {
      case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP:
        return "bluetooth"
      case .headphones, .usbAudio:
        return "wired"
      case .airPlay:
        return "airplay"
      case .builtInSpeaker, .builtInReceiver:
        return "speaker"
      default:
        continue
      }
    }

    return "other"
  }
}
