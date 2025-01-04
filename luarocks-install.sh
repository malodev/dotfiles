mkdir -p $HOME/.local/src
cd $HOME/.local/src
wget https://luarocks.org/releases/luarocks-3.11.1.tar.gz
tar zxpf luarocks-3.11.1.tar.gz
cd luarocks-3.11.1
./configure --prefix=$HOME/.local && make && make install
