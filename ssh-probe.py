import paramiko

HOST = '13.229.183.21'
KEYS = [r'D:\文档\亚马逊\126.pem', r'D:\文档\亚马逊\LessonFlow.pem']
USERS = ['ubuntu', 'root', 'ec2-user', 'admin', 'debian']

for key in KEYS:
    try:
        pkey = paramiko.RSAKey.from_private_key_file(key)
    except Exception as e:
        print(f'{key}: load fail {str(e)[:80]}')
        continue
    for user in USERS:
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            c.connect(HOST, port=22, username=user, pkey=pkey,
                      timeout=10, banner_timeout=10, auth_timeout=10,
                      allow_agent=False, look_for_keys=False)
            stdin, stdout, stderr = c.exec_command('whoami; lsb_release -rs')
            print(f'HIT: {user} + {key.split(chr(92))[-1]} => {stdout.read().decode().strip()}')
            c.close()
        except paramiko.AuthenticationException:
            print(f'no: {user} + {key.split(chr(92))[-1]} (auth fail)')
        except Exception as e:
            print(f'no: {user} + {key.split(chr(92))[-1]} ({str(e)[:60]})')
        finally:
            c.close()
