# Passos para liberar (release/deploy)

## 1. Validar
```sh
npm test            # todos os testes devem passar
```

## 2. Integrar na branch principal
1. Abrir um pull request de `claude/ecstatic-maxwell-ko69du` para a branch principal.
2. Revisar e fazer o merge.
3. Criar a tag de versão: `git tag v1.0.0 && git push origin v1.0.0`.

## 3. Publicar (Docker)
```sh
docker build -t agendamento:1.0.0 .
docker run -d --name agendamento -p 3000:3000 -v agendamento-data:/data agendamento:1.0.0
```
O volume `/data` guarda o banco SQLite; sem ele os dados se perdem ao recriar o contêiner.

Sem Docker: Node ≥ 22.13 no servidor, `PORT=3000 DB_PATH=/var/lib/agendamento/agendamento.db npm start`
(use systemd ou pm2 para manter o processo no ar).

## 4. Pós-publicação
1. Abrir `http://<servidor>:3000` e conferir que a página carrega.
2. Cadastrar serviços, profissionais e expediente (exemplos `curl` no README).
3. Fazer um agendamento de teste e cancelá-lo.

## 5. Antes de expor na internet
- Colocar atrás de um proxy HTTPS (nginx, Caddy ou similar).
- **A API não tem autenticação**: restrinja o acesso (rede privada, proxy com senha) ou implemente login antes de abrir ao público.
- Agendar backup periódico do arquivo do banco.

## Rollback
Subir novamente a imagem anterior (`agendamento:<versão anterior>`) com o mesmo volume `/data`.
