let SessionLoad = 1
let s:so_save = &g:so | let s:siso_save = &g:siso | setg so=0 siso=0 | setl so=-1 siso=-1
let v:this_session=expand("<sfile>:p")
silent only
silent tabonly
cd ~/dotfiles
if expand('%') == '' && !&modified && line('$') <= 1 && getline(1) == ''
  let s:wipebuf = bufnr('%')
endif
let s:shortmess_save = &shortmess
if &shortmess =~ 'A'
  set shortmess=aoOA
else
  set shortmess=aoO
endif
badd +14 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/mini.lua
badd +1 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/oil.lua
badd +26 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/options.lua
badd +5 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/lsp.lua
badd +1 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/blink.lua
badd +4 ~/dotfiles/nvim-test/.config/nvim-test/init.lua
badd +43 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/lazy.lua
badd +89 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/keymaps.lua
badd +7 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/codeium.lua
badd +56 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/completion.lua
badd +7 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/catppuccin.lua
badd +10 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/copilot.lua
badd +18 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/lualine.lua
badd +385 ~/dotfiles/nvim-malo/.config/nvim-malo/lua/keymaps.lua
badd +10 ~/dotfiles/nvim-malo/.config/nvim-malo/lua/.luarc.json
badd +1 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/yazi.lua
badd +2 ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/which-key.lua
badd +9 ~/dotfiles/nvim-malo/.config/nvim-malo/lua/plugins_notvscode/which-key.lua
argglobal
%argdel
edit ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/lualine.lua
argglobal
balt ~/dotfiles/nvim-test/.config/nvim-test/lua/config/plugins/codeium.lua
setlocal fdm=manual
setlocal fde=0
setlocal fmr={{{,}}}
setlocal fdi=#
setlocal fdl=0
setlocal fml=1
setlocal fdn=20
setlocal fen
silent! normal! zE
let &fdl = &fdl
let s:l = 18 - ((17 * winheight(0) + 20) / 40)
if s:l < 1 | let s:l = 1 | endif
keepjumps exe s:l
normal! zt
keepjumps 18
normal! 0
tabnext 1
if exists('s:wipebuf') && len(win_findbuf(s:wipebuf)) == 0 && getbufvar(s:wipebuf, '&buftype') isnot# 'terminal'
  silent exe 'bwipe ' . s:wipebuf
endif
unlet! s:wipebuf
set winheight=1 winwidth=20
let &shortmess = s:shortmess_save
let s:sx = expand("<sfile>:p:r")."x.vim"
if filereadable(s:sx)
  exe "source " . fnameescape(s:sx)
endif
let &g:so = s:so_save | let &g:siso = s:siso_save
set hlsearch
doautoall SessionLoadPost
unlet SessionLoad
" vim: set ft=vim :
