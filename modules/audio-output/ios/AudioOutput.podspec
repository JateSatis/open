Pod::Spec.new do |s|
  s.name           = 'AudioOutput'
  s.version        = '1.0.0'
  s.summary        = 'Громкость медиа и маршрут звука для журнала рекомендаций'
  s.description    = 'Только чтение: громкость, без звука, куда идёт звук'
  s.author         = ''
  s.homepage       = 'https://openger.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
end
