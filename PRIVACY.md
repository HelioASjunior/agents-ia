# Privacidade

O XinoIA roda no seu computador. Ele não tem servidor próprio, cadastro nem telemetria, e não transfere informações para outros sistemas em rede, a não ser nos casos abaixo, pedidos por você ou por quem instala ou opera o programa.

## Para onde os dados vão

| O quê | Para onde | Quando | Como controlar |
| --- | --- | --- | --- |
| Seus pedidos e os arquivos que o agente lê | O fornecedor da ferramenta de IA que você escolheu, como Anthropic ou OpenAI, pelo CLI oficial dele | Quando um agente trabalha | Você escolhe a ferramenta, a conta e a permissão de cada agente. Vale a política de privacidade de cada fornecedor |
| Verificação de atualizações | GitHub (`github.com`), que recebe o pedido e o seu endereço IP, como em qualquer download | Ao abrir o programa e a cada 4 horas | Desligue a verificação automática em Configurações > Atualizações |
| Download de uma ferramenta de IA | O site oficial do fornecedor | Só quando você clica em **Instalar** | O comando aparece antes de rodar |
| Login em uma ferramenta de IA | A página oficial do fornecedor, no seu navegador | Só quando você clica em **Entrar pelo navegador** | O XinoIA não vê sua senha nem seus tokens |

## O que fica só no seu computador

Projetos, conversas, histórico, memória dos projetos e registros ficam em um banco de dados local. Uma chave de API, se você informar uma, fica cifrada pelo Windows, presa ao seu usuário, e só é entregue à ferramenta do perfil dela.

O XinoIA não coleta estatísticas de uso nem relatórios de erro.

## Seus dados ao desinstalar

Desinstalar remove o programa e mantém os seus dados, para não apagar trabalho sem querer. Eles ficam em `%APPDATA%\XinoIA`, e você pode apagar essa pasta se quiser removê-los.
