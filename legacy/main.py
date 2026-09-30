import sys

VERSION = "0.1.1-network"

def main():
    args = sys.argv[1:]
    
    if args and "--server" == args[0]:
        from rts_server import main
        main(args[1:])
    else: 
        from rts_client import Game
        game = Game()
        game.main_game_loop()

if __name__ == "__main__":
    main()
