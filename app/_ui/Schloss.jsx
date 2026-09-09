// Steht dort, wo eine Zahl stünde, die dieser Mensch nicht zeigt.
//
// **Ein Schloss, kein Strich.** „–" heißt in diesem Projekt überall
// „nicht bekannt"; hier ist die Zahl aber bekannt und wird bewusst
// nicht gezeigt. Zwei sehr verschiedene Dinge dürfen nicht gleich
// aussehen.
//
// Das Zeichen trägt die Aussage nicht allein: Der Titel nennt sie im
// Klartext, und für Vorleseprogramme steht sie als Text daneben —
// dieselbe Regel wie bei den Startelf-Zeichen.
export default function Schloss({ wer = null }) {
  const text = wer ? `${wer} zeigt diese Zahl nicht` : "Diese Zahl ist nicht öffentlich";
  return (
    <span className="kb-verborgen" title={text}>
      <span aria-hidden="true">🔒</span>
      <span className="kb-nurvorleser">{text}</span>
    </span>
  );
}
