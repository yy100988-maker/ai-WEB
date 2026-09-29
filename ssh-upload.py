import paramiko

HOST = '13.229.183.21'
KEY = r'D:\文档\亚马逊\126.pem'
USER = 'ubuntu'

LOCAL = r'D:\CODEX\WEB\vutu-deploy.tar.gz'
REMOTE = '/home/ubuntu/apps/vutu-deploy.tar.gz'

t = paramiko.Transport((HOST, 22))
pkey = paramiko.RSAKey.from_private_key_file(KEY)
t.connect(username=USER, pkey=pkey)
sftp = paramiko.SFTPClient.from_transport(t)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, port=22, username=USER, key_filename=KEY,
          allow_agent=False, look_for_keys=False)
c.exec_command('mkdir -p /home/ubuntu/apps/ai-WEB/ai-cloner')

sftp.put(LOCAL, REMOTE)
print('uploaded', REMOTE)
sftp.close()
t.close()
c.close()
