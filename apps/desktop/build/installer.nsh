; Atalho opcional na área de trabalho. Em atualizações e instalações silenciosas, não pergunta.
!macro customInstall
  ${IfNot} ${isUpdated}
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION "Criar um atalho do XinoIA na área de trabalho?" IDNO +2
        CreateShortCut "$DESKTOP\XinoIA.lnk" "$INSTDIR\XinoIA.exe"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Delete "$DESKTOP\XinoIA.lnk"
  ${EndIf}
!macroend
